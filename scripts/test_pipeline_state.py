import unittest
from datetime import datetime, timezone

from scripts.pipeline_state import (
    is_retryable_http_status,
    mark_attempt,
    mark_failure,
)
from scripts.review_privacy import safe_review_error, safe_review_label


class PipelineRetryStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def record_failure(self, entry: dict, *, terminal_eligible: bool) -> None:
        mark_attempt(entry, now=self.now)
        mark_failure(
            entry,
            "test-failure",
            max_terminal_attempts=8,
            terminal_eligible=terminal_eligible,
            now=self.now,
        )

    def test_provider_failures_do_not_consume_terminal_attempts(self) -> None:
        entry: dict = {}
        for _ in range(7):
            self.record_failure(entry, terminal_eligible=False)

        self.record_failure(entry, terminal_eligible=True)

        self.assertEqual(entry["ai_attempts"], 8)
        self.assertEqual(entry["ai_terminal_attempts"], 1)
        self.assertNotIn("ai_terminal_failure", entry)
        self.assertFalse(entry.get("ai_processed", False))

    def test_only_terminal_eligible_failures_can_reject(self) -> None:
        entry: dict = {}
        for _ in range(8):
            self.record_failure(entry, terminal_eligible=True)

        self.assertEqual(entry["ai_terminal_attempts"], 8)
        self.assertTrue(entry["ai_terminal_failure"])
        self.assertTrue(entry["ai_processed"])
        self.assertFalse(entry["is_portfolio"])
        self.assertNotIn("ai_next_retry_at", entry)

    def test_nonterminal_failures_still_receive_bounded_backoff(self) -> None:
        entry = {"ai_attempts": 100}
        mark_failure(
            entry,
            "provider-unavailable",
            max_terminal_attempts=8,
            terminal_eligible=False,
            now=self.now,
        )

        self.assertEqual(
            entry["ai_next_retry_at"],
            "2026-01-08T00:00:00+00:00",
        )
        self.assertNotIn("ai_terminal_attempts", entry)

    def test_transient_http_failures_are_retryable(self) -> None:
        for status in (408, 425, 429, 500, 502, 503, 504, 599):
            with self.subTest(status=status):
                self.assertTrue(is_retryable_http_status(status))

        for status in (200, 301, 400, 401, 404, 410):
            with self.subTest(status=status):
                self.assertFalse(is_retryable_http_status(status))

    def test_private_review_logs_redact_names_urls_and_error_messages(self) -> None:
        private_entry = {
            "__private_submission_review_id": "private-id",
            "name": "Private Person",
            "url": "https://private.example",
        }
        error = RuntimeError("request failed for https://private.example")

        self.assertEqual(
            safe_review_label(
                private_entry,
                f"{private_entry['name']} | {private_entry['url']}",
            ),
            "[private submission]",
        )
        self.assertEqual(safe_review_error(private_entry, error), "RuntimeError")
        self.assertEqual(
            safe_review_label({}, "https://public.example"),
            "https://public.example",
        )


if __name__ == "__main__":
    unittest.main()

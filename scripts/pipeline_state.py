"""Pure retry-state helpers shared by the AI enrichment pipeline."""

from datetime import datetime, timedelta, timezone


def is_retryable_http_status(status: int) -> bool:
    return status in {408, 425, 429} or 500 <= status <= 599


def mark_attempt(entry: dict, *, now: datetime | None = None) -> None:
    attempts = entry.get("ai_attempts")
    entry["ai_attempts"] = (
        attempts if isinstance(attempts, int) and attempts >= 0 else 0
    ) + 1
    timestamp = now or datetime.now(timezone.utc)
    entry["ai_last_attempt_at"] = timestamp.astimezone(timezone.utc).isoformat()
    entry.pop("ai_next_retry_at", None)


def mark_failure(
    entry: dict,
    reason: str,
    *,
    max_terminal_attempts: int,
    terminal_eligible: bool = True,
    now: datetime | None = None,
) -> None:
    attempts = entry.get("ai_attempts", 1)
    if not isinstance(attempts, int) or attempts < 1:
        attempts = 1
        entry["ai_attempts"] = attempts

    entry["ai_last_error"] = reason
    if terminal_eligible:
        terminal_attempts = entry.get("ai_terminal_attempts")
        terminal_attempts = (
            terminal_attempts
            if isinstance(terminal_attempts, int) and terminal_attempts >= 0
            else 0
        ) + 1
        entry["ai_terminal_attempts"] = terminal_attempts
        if terminal_attempts >= max_terminal_attempts:
            entry["ai_processed"] = True
            entry["is_portfolio"] = False
            entry["ai_terminal_failure"] = True
            entry.pop("ai_next_retry_at", None)
            return

    retry_hours = min(7 * 24, 2 ** min(attempts, 8))
    timestamp = now or datetime.now(timezone.utc)
    entry["ai_next_retry_at"] = (
        timestamp.astimezone(timezone.utc) + timedelta(hours=retry_hours)
    ).isoformat()

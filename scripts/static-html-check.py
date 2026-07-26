"""Validate accessibility and structural invariants in the built home page."""

from __future__ import annotations

import json
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path


class AuditParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.ids: Counter[str] = Counter()
        self.nested_interactives = 0
        self.close_buttons_without_labels = 0
        self.card_title_depth: int | None = None
        self.card_title_text = ""
        self.blank_card_titles = 0

    def handle_starttag(
        self,
        tag: str,
        attrs_list: list[tuple[str, str | None]],
    ) -> None:
        attrs = dict(attrs_list)
        classes = set((attrs.get("class") or "").split())

        element_id = attrs.get("id")
        if element_id:
            self.ids[element_id] += 1

        if tag in {"a", "button"} and any(
            ancestor in {"a", "button"} for ancestor in self.stack
        ):
            self.nested_interactives += 1

        if (
            tag == "button"
            and attrs.get("id") in {"closeLoginBtn", "closeSubmitBtn"}
            and not attrs.get("aria-label")
        ):
            self.close_buttons_without_labels += 1

        if tag == "h3" and "portfolio-name" in classes:
            self.card_title_depth = len(self.stack)
            self.card_title_text = ""

        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input",
                       "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if (
            tag == "h3"
            and self.card_title_depth is not None
            and len(self.stack) - 1 == self.card_title_depth
        ):
            if not self.card_title_text.strip():
                self.blank_card_titles += 1
            self.card_title_depth = None
            self.card_title_text = ""

        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if self.card_title_depth is not None:
            self.card_title_text += data


def main() -> None:
    source_path = Path(sys.argv[1] if len(sys.argv) > 1 else "dist/index.html")
    source = source_path.read_text(encoding="utf-8")
    parser = AuditParser()
    parser.feed(source)

    duplicate_ids = {
        element_id: count
        for element_id, count in parser.ids.items()
        if count > 1
    }
    broken_base_paths = [
        value
        for value in (
            "/Portfolio-Universefavicon",
            "/Portfolio-Universeterms",
            "/Portfolio-Universeprivacy",
        )
        if value in source
    ]

    results = {
        "duplicate_ids": duplicate_ids,
        "nested_interactives": parser.nested_interactives,
        "close_buttons_without_labels": parser.close_buttons_without_labels,
        "blank_card_titles": parser.blank_card_titles,
        "broken_base_paths": broken_base_paths,
        "has_skip_link": 'class="skip-link"' in source,
        "has_live_results": 'id="resultStatus"' in source
        and 'aria-live="polite"' in source,
    }
    print(json.dumps(results, indent=2))

    failed = (
        bool(duplicate_ids)
        or parser.nested_interactives > 0
        or parser.close_buttons_without_labels > 0
        or parser.blank_card_titles > 0
        or bool(broken_base_paths)
        or not results["has_skip_link"]
        or not results["has_live_results"]
    )
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()

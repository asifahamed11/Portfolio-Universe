#!/usr/bin/env python3
# DEPRECATED / DISABLED — do not run.
#
# This was a one-off repair script that rewrote everything in
# src/pages/index.astro after the `createSkeletonHTML` marker with a hard-coded
# tail. That hard-coded tail is now OUT OF DATE: running it would REVERT several
# shipped fixes (visibleCount reset / "BUG-6", the dedup-aware sound logic,
# playDropSound, and the PERF-4 search path).
#
# It is intentionally neutralized to prevent accidental regressions. The file is
# kept only so existing references/links don't 404. Safe to delete entirely.

import sys

print(
    "fix_index.py is deprecated and disabled. It would overwrite src/pages/index.astro "
    "with a stale snapshot and revert current fixes. Aborting without changes."
)
sys.exit(1)

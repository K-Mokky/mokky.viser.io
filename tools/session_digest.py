#!/usr/bin/env python3
"""
Viser session digest helper.

Usage:
  python tools/session_digest.py .viser/sessions/cli__example_project.jsonl

This is intentionally small and optional: TypeScript runs the assistant, while
Python helps inspect JSONL logs during maintenance.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python tools/session_digest.py <session.jsonl>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        return 1

    messages = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        messages.append(json.loads(line))

    print(f"session_file: {path}")
    print(f"messages: {len(messages)}")
    for index, message in enumerate(messages[-10:], start=max(1, len(messages) - 9)):
        role = message.get("role", "?")
        at = message.get("at", "?")
        content = " ".join(str(message.get("content", "")).split())
        print(f"{index:03d}. {at} {role}: {content[:160]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

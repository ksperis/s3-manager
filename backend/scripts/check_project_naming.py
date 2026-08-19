#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
UPGRADE_FILE = Path("doc/docs/ops/upgrade-to-bucketreef.md")
HISTORICAL_PREFIXES = (Path("doc/audits"),)
ORIGINAL_NAME_PATTERNS = (
    re.compile("s3" + r"[-_ ]manager", re.IGNORECASE),
    re.compile("s3" + "manager", re.IGNORECASE),
    re.compile("s3" + "m", re.IGNORECASE),
)
WITHDRAWN_NAME_PATTERNS = (
    re.compile("ka" + "elo", re.IGNORECASE),
    re.compile("kl" + "o-", re.IGNORECASE),
)
BASE64_DATA_PAYLOAD = re.compile(r"(?<=base64,)[A-Za-z0-9+/=\r\n]+")


def _tracked_paths() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
    )
    return [Path(item.decode("utf-8")) for item in result.stdout.split(b"\0") if item]


def _historical(path: Path) -> bool:
    return any(path == prefix or prefix in path.parents for prefix in HISTORICAL_PREFIXES)


def _matches(value: str, patterns: tuple[re.Pattern[str], ...]) -> list[str]:
    return sorted({match.group(0) for pattern in patterns for match in pattern.finditer(value)})


def main() -> int:
    failures: list[str] = []
    for relative_path in _tracked_paths():
        absolute_path = REPOSITORY_ROOT / relative_path
        if not absolute_path.is_file() or _historical(relative_path):
            continue

        patterns = WITHDRAWN_NAME_PATTERNS
        if relative_path != UPGRADE_FILE:
            patterns += ORIGINAL_NAME_PATTERNS

        path_matches = _matches(relative_path.as_posix(), patterns)
        if path_matches:
            failures.append(f"{relative_path}: forbidden former-name path fragment(s): {', '.join(path_matches)}")

        try:
            content = absolute_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        searchable_content = BASE64_DATA_PAYLOAD.sub("<binary-payload>", content)
        content_matches = _matches(searchable_content, patterns)
        if content_matches:
            failures.append(f"{relative_path}: forbidden former-name content fragment(s): {', '.join(content_matches)}")

    if failures:
        print("Project naming check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("Project naming check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

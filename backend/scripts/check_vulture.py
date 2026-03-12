#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def load_allowlist(path: Path) -> list[str]:
    if not path.exists():
        return []
    entries: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        entries.append(line)
    return entries


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    allowlist = load_allowlist(root / "deadcode" / "vulture_allowlist.txt")
    cmd = [
        sys.executable,
        "-m",
        "vulture",
        str(root / "app" / "services"),
        str(root / "app" / "utils"),
        "--min-confidence",
        "100",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    raw_output = proc.stdout.strip()
    if not raw_output:
        print("vulture check passed.")
        return 0

    findings = [line for line in raw_output.splitlines() if line.strip()]
    remaining = [
        line
        for line in findings
        if not any(allowed in line for allowed in allowlist)
    ]
    if remaining:
        print("\n".join(remaining))
        print("vulture check failed: unallowlisted findings above.")
        return 1

    print("vulture check passed (all findings allowlisted).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

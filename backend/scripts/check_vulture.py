#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    cmd = [
        sys.executable,
        "-m",
        "vulture",
        str(root / "app"),
        "--min-confidence",
        "100",
    ]
    proc = subprocess.run(cmd, check=False)
    if proc.returncode == 0:
        print("vulture check passed.")
        return 0

    print("vulture check failed: dead code findings above.")
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())

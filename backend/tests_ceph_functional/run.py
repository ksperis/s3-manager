#!/usr/bin/env python3
# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    backend_root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    pythonpath = env.get("PYTHONPATH", "")
    if pythonpath:
        env["PYTHONPATH"] = f"{backend_root}:{pythonpath}"
    else:
        env["PYTHONPATH"] = str(backend_root)

    cmd = ["pytest", "tests_ceph_functional", "-m", "ceph_functional"]
    if len(argv) > 1:
        cmd.extend(argv[1:])

    process = subprocess.run(cmd, cwd=backend_root, env=env, check=False)
    return process.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv))

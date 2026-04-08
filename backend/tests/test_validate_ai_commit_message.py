# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "validate_ai_commit_message.py"


def _run_validator(tmp_path: Path, message: str) -> subprocess.CompletedProcess[str]:
    message_path = tmp_path / "commit-message.txt"
    message_path.write_text(message, encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(SCRIPT_PATH), str(message_path)],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize(
    "header",
    [
        "feat(frontend): add browser object compare panel",
        "fix(ci): stabilize browser e2e bootstrap",
        "chore(release): prepare v0.1.6",
    ],
)
def test_validate_ai_commit_message_accepts_expected_valid_examples(tmp_path: Path, header: str):
    proc = _run_validator(
        tmp_path,
        f"""{header}

Why:
Keep AI-authored commit messages compatible with automated changelog tooling.

What:
- add a normalized commit header
- document the structured body format

Validation:
- not run (validator coverage only)
""",
    )

    assert proc.returncode == 0
    assert "validation passed" in proc.stdout.lower()


@pytest.mark.parametrize(
    ("message", "expected_error"),
    [
        (
            """Normalize AI commit messages

Why:
Keep commit history easier to parse.

What:
- add a validator

Validation:
- not run (validator coverage only)
""",
            "Header must follow Conventional Commits",
        ),
        (
            "fix(ci): stabilize browser e2e bootstrap\n",
            "Missing required section header `Why:`.",
        ),
        (
            """fix(ci): stabilize browser e2e bootstrap

Why:
Keep the commit body structured.

What:
- add the Why and What sections
""",
            "Missing required section header `Validation:`.",
        ),
        (
            """feat(frontend)!: add browser object compare panel

Why:
Surface a breaking UI rename in the commit history.

What:
- rename the compare entry point

Validation:
- not run (validator coverage only)
""",
            "Breaking commits must include a `BREAKING CHANGE:` footer.",
        ),
    ],
)
def test_validate_ai_commit_message_rejects_expected_invalid_examples(
    tmp_path: Path,
    message: str,
    expected_error: str,
):
    proc = _run_validator(tmp_path, message)

    assert proc.returncode == 1
    assert expected_error in proc.stdout


def test_validate_ai_commit_message_accepts_breaking_change_footer(tmp_path: Path):
    proc = _run_validator(
        tmp_path,
        """refactor(manager)!: rename execution context selector

Why:
Align the selector naming with the updated manager terminology.

What:
- rename the manager execution context selector in docs
- update the helper text for the new label

Validation:
- not run (documentation-only change)

BREAKING CHANGE: manager automation must use the new execution context selector name.
""",
    )

    assert proc.returncode == 0
    assert "validation passed" in proc.stdout.lower()

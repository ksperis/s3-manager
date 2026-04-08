#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ALLOWED_TYPES = ("feat", "fix", "refactor", "perf", "test", "docs", "build", "ci", "chore", "revert")
SECTION_ORDER = ("Why", "What", "Validation")
HEADER_RE = re.compile(
    r"^(?P<type>"
    + "|".join(ALLOWED_TYPES)
    + r")"
    r"(?:\((?P<scope>[a-z0-9][a-z0-9/-]*)\))?"
    r"(?P<breaking>!)?: "
    r"(?P<subject>.+)$"
)


def _strip_comment_lines(text: str) -> list[str]:
    return [line.rstrip() for line in text.splitlines() if not line.lstrip().startswith("#")]


def _trim_blank_edges(lines: list[str]) -> list[str]:
    start = 0
    end = len(lines)
    while start < end and not lines[start].strip():
        start += 1
    while end > start and not lines[end - 1].strip():
        end -= 1
    return lines[start:end]


def _normalize_content(lines: list[str]) -> list[str]:
    return _trim_blank_edges(lines)


def _is_breaking_footer_start(lines: list[str], index: int) -> bool:
    return (
        lines[index].strip().startswith("BREAKING CHANGE:")
        and index > 0
        and not lines[index - 1].strip()
    )


def _parse_sections(lines: list[str]) -> tuple[dict[str, list[str]], list[str], list[str]]:
    errors: list[str] = []
    sections: dict[str, list[str]] = {}
    index = 1
    while index < len(lines) and not lines[index].strip():
        index += 1

    for offset, name in enumerate(SECTION_ORDER):
        expected_header = f"{name}:"
        if index >= len(lines) or lines[index].strip() != expected_header:
            errors.append(f"Missing required section header `{expected_header}`.")
            return sections, [], errors

        index += 1
        content: list[str] = []
        while index < len(lines):
            stripped = lines[index].strip()
            remaining_headers = {f"{section_name}:" for section_name in SECTION_ORDER[offset + 1 :]}
            if stripped in remaining_headers:
                break
            if name == "Validation" and _is_breaking_footer_start(lines, index):
                break
            content.append(lines[index])
            index += 1

        sections[name] = _normalize_content(content)
        while index < len(lines) and not lines[index].strip():
            index += 1

    return sections, lines[index:], errors


def validate_commit_message(text: str) -> list[str]:
    lines = _trim_blank_edges(_strip_comment_lines(text))
    if not lines:
        return ["Commit message is empty."]

    errors: list[str] = []
    header = lines[0].strip()
    header_match = HEADER_RE.match(header)
    if not header_match:
        errors.append(
            "Header must follow Conventional Commits: "
            "`<type>(<scope>): <imperative summary>`."
        )
        return errors

    subject = header_match.group("subject").strip()
    if subject.endswith("."):
        errors.append("Header subject must not end with a period.")

    sections, footer_lines, parse_errors = _parse_sections(lines)
    errors.extend(parse_errors)
    if parse_errors:
        return errors

    why_lines = [line for line in sections["Why"] if line.strip()]
    if not why_lines:
        errors.append("`Why:` must include 1-2 sentences describing intent.")

    what_lines = [line.strip() for line in sections["What"] if line.strip()]
    if not what_lines:
        errors.append("`What:` must include 1-3 bullet points.")
    elif any(not line.startswith("- ") for line in what_lines):
        errors.append("`What:` entries must be bullet points starting with `- `.")
    elif not 1 <= len(what_lines) <= 3:
        errors.append("`What:` must contain between 1 and 3 bullet points.")

    validation_lines = [line for line in sections["Validation"] if line.strip()]
    if not validation_lines:
        errors.append("`Validation:` must describe executed checks or explain why they were not run.")

    has_breaking_footer = any(line.strip().startswith("BREAKING CHANGE:") for line in footer_lines if line.strip())
    if header_match.group("breaking") and not has_breaking_footer:
        errors.append("Breaking commits must include a `BREAKING CHANGE:` footer.")
    if has_breaking_footer:
        for line in footer_lines:
            stripped = line.strip()
            if stripped.startswith("BREAKING CHANGE:") and stripped == "BREAKING CHANGE:":
                errors.append("`BREAKING CHANGE:` footer must include a description.")
                break

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate an AI-authored commit message against the repository convention."
    )
    parser.add_argument("message_file", type=Path, help="Path to the commit message file to validate.")
    args = parser.parse_args(argv)

    try:
        text = args.message_file.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"Unable to read commit message file: {exc}", file=sys.stderr)
        return 2

    errors = validate_commit_message(text)
    if errors:
        print("AI commit message validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("AI commit message validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict


STATUS_PRIORITY = {
    "setup_error": 5,
    "failed": 4,
    "teardown_error": 3,
    "skipped": 2,
    "passed": 1,
}


@dataclass
class ScenarioResult:
    nodeid: str
    status: str
    duration: float


class RunSummary:
    def __init__(self) -> None:
        self._results: Dict[str, ScenarioResult] = {}
        self.cleanup_errors: list[str] = []

    def record(self, nodeid: str, status: str, duration: float) -> None:
        priority = STATUS_PRIORITY.get(status, 0)
        current = self._results.get(nodeid)
        if current:
            current_priority = STATUS_PRIORITY.get(current.status, 0)
            if priority < current_priority:
                return
        self._results[nodeid] = ScenarioResult(nodeid=nodeid, status=status, duration=duration)

    def record_cleanup_errors(self, errors: list[str]) -> None:
        if not errors:
            return
        self.cleanup_errors.extend(errors)

    def ordered_results(self) -> list[ScenarioResult]:
        return sorted(self._results.values(), key=lambda result: result.nodeid)

    def as_table(self) -> str:
        results = self.ordered_results()
        if not results:
            return ""
        header = f"{'Test':<80} {'Status':<15} {'Duration(s)':>12}"
        lines = [header, "-" * len(header)]
        for result in results:
            lines.append(f"{result.nodeid:<80} {result.status:<15} {result.duration:>12.2f}")
        return "\n".join(lines)


__all__ = ["RunSummary", "ScenarioResult"]

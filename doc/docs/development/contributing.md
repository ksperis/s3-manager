
# Contributing

## Repository expectations

- Keep IAM as the source of truth
- Avoid introducing “shadow authorization” in the UI or database
- Prefer capability-based UX (feature detection, graceful degradation)

## Pull requests

A good PR includes:

- a clear intent and design rationale
- test strategy (unit, integration, manual)
- documentation updates when behavior changes
- migration notes when DB schema changes

## Style

Follow existing conventions in the repo:

- backend: FastAPI + Pydantic patterns
- frontend: React + TypeScript + Tailwind

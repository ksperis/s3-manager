# Agent Instructions

Before making any non-trivial change in this repository, read
`doc/docs/developer/ai-assistant-guidelines.md` and follow its architectural,
security, and documentation constraints.

Use the local Codex toolkit before reading large parts of the repository:

- `tools/codex/project-map.sh` for a compact repository overview.
- `tools/codex/frontend-map.sh`, `tools/codex/backend-map.sh`, and
  `tools/codex/docs-map.sh` for targeted surface maps.
- `tools/codex/search-symbol.sh <query>` before broad manual file reads.
- `tools/codex/rtk-map.sh` before assuming Redux Toolkit or RTK Query
  structure.
- `tools/codex/test-target.sh <path-or-keyword>` before running broad test
  suites.
- `tools/codex/changed-context.sh` to summarize local Git changes without
  dumping full diffs.

Avoid sending or reading noisy context by default. Skip `node_modules`, `dist`,
`build`, `coverage`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`,
`__pycache__`, Playwright reports, generated screenshots unless visual QA
requires them, lock files, local databases, logs, and other generated artifacts.

Prefer the existing project conventions:

- Frontend lives in `frontend/src` with routes in `frontend/src/router.tsx`,
  API clients in `frontend/src/api`, shared components in
  `frontend/src/components`, and workspace features in `frontend/src/features`.
- Backend lives in `backend/app` with thin FastAPI routers, services, models,
  DB modules, and tests in `backend/tests`.
- Documentation lives in `doc/docs`; extend existing pages instead of creating
  duplicate architecture or workflow docs.
- Use targeted frontend commands from `frontend/package.json` and targeted
  backend pytest files when possible.
- In this Codex environment, prefix shell commands with `rtk` as described in
  `/Users/laurent/.codex/RTK.md`.

When an AI assistant creates a Git commit in this repository, it must use the
Conventional Commit and structured body rules documented in
`doc/docs/developer/ai-assistant-guidelines.md`.

# Codex Local Toolkit

Small, local scripts to help Codex inspect this repository without reading or
sending too much context to the model.

Run scripts from the repository root. They avoid `node_modules`, generated
build output, coverage, local databases, lock files, reports, and other noisy
artifacts by default.

## Scripts

- `tools/codex/project-map.sh`
  Prints a compact repository overview: frontend, backend, docs, ops, Helm,
  configs, and test counts.

- `tools/codex/search-symbol.sh <query>`
  Searches for a symbol, route, hook, API endpoint, component, slice, or keyword
  using `rg` when available, with a grep fallback.

- `tools/codex/frontend-map.sh`
  Summarizes frontend structure: routes, feature folders, pages, layouts,
  shared components, API clients, hooks, providers, tests, and RTK signals.

- `tools/codex/rtk-map.sh`
  Detects Redux Toolkit and RTK Query artifacts such as stores, slices,
  reducers, actions, selectors, API slices, endpoints, and generated hooks.
  If none are found, it says so explicitly.

- `tools/codex/backend-map.sh`
  Summarizes backend structure: FastAPI entry point, registered routers,
  router prefixes/endpoints, models, DB modules, services, and tests.

- `tools/codex/docs-map.sh`
  Lists existing documentation entry points for architecture, conventions,
  local development, API reference, user workflows, operations, and docs
  maintenance.

- `tools/codex/test-target.sh <path-or-keyword>`
  Tries to identify and run focused frontend or backend tests for a file,
  module, or keyword. It avoids launching the full suite when a narrower target
  is available.

- `tools/codex/changed-context.sh`
  Shows compact context for Git changes: status, diff stat, changed files, and
  relevant symbols/routes/endpoints touched. It does not print full diffs by
  default.

## Examples

```bash
tools/codex/project-map.sh
tools/codex/frontend-map.sh
tools/codex/backend-map.sh
tools/codex/docs-map.sh
tools/codex/search-symbol.sh PortalStorageSpace
tools/codex/rtk-map.sh
tools/codex/test-target.sh frontend/src/features/portal/PortalDashboard.tsx
tools/codex/test-target.sh portal_service
tools/codex/changed-context.sh
```

In this Codex environment, shell commands should still be prefixed with `rtk`:

```bash
rtk tools/codex/project-map.sh
rtk tools/codex/test-target.sh PortalDashboard
```

## How Codex Should Use This

Start with `project-map.sh`, then choose the smallest relevant surface map.
Use `search-symbol.sh` before opening large files. Use `test-target.sh` before
falling back to broad test suites. Use `changed-context.sh` before summarizing
or committing local work.

Keep context tight: inspect the files these scripts point to, not whole
directories. Only open generated screenshots, lock files, reports, or full
diffs when the task specifically requires them.

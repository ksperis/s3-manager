#!/usr/bin/env bash
# Summarize frontend structure, routes, API clients, features, and tests.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
codex_cd_root

printf '# Frontend map\n'

codex_heading "Core files"
for file in frontend/src/main.tsx frontend/src/router.tsx frontend/src/index.css frontend/package.json frontend/vite.config.ts frontend/vitest.config.ts frontend/tsconfig.check.json; do
  [ -f "$file" ] && printf '%s\n' "$file"
done

codex_heading "Feature areas"
find frontend/src/features -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | sed 's#^#- #'

codex_heading "Routes"
codex_search '<Route path=|path="/|createBrowserRouter|Navigate to=' frontend/src/router.tsx | codex_limit 120

codex_heading "Pages and layouts"
codex_files frontend/src/features frontend/src/components 2>/dev/null \
  | grep -E '(Page|Dashboard|Layout|Shell|Modal)\.(tsx|ts)$' \
  | sort \
  | codex_limit 140

codex_heading "API clients"
codex_files frontend/src/api 2>/dev/null | sort | codex_limit 120

codex_heading "Hooks and providers"
codex_search 'export function use[A-Z]|function use[A-Z]|Provider\(|createContext' frontend/src | codex_limit 120

codex_heading "Redux Toolkit / RTK Query signals"
"$SCRIPT_DIR/rtk-map.sh" --summary

codex_heading "Frontend tests"
codex_files frontend/src frontend/e2e frontend/scripts 2>/dev/null \
  | grep -E '\.(test|spec)\.(ts|tsx|js|jsx)$' \
  | sort \
  | codex_limit 120

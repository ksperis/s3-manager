#!/usr/bin/env bash
# Print a compact repository map for Codex orientation.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
codex_cd_root

printf '# s3-manager project map\n'
printf 'Root: %s\n' "$(pwd)"

codex_heading "Top-level areas"
for area in frontend backend doc helm ops tools .github; do
  if [ -e "$area" ]; then
    printf '%-10s %5s files\n' "$area" "$(codex_count_files "$area")"
  fi
done

codex_heading "Important configs"
for file in README.md AGENTS.md docker-compose.yml docker-compose.build.yml pytest.ini frontend/package.json frontend/vite.config.ts frontend/vitest.config.ts frontend/playwright.docs.config.ts backend/pytest.ini backend/alembic.ini doc/mkdocs.yml helm/s3-manager/Chart.yaml; do
  [ -f "$file" ] && printf '%s\n' "$file"
done

codex_heading "Frontend"
printf 'Source: frontend/src\n'
printf 'Routes: frontend/src/router.tsx\n'
printf 'API clients: frontend/src/api\n'
if [ -d frontend/src/features ]; then
  printf 'Features: '
  find frontend/src/features -maxdepth 1 -mindepth 1 -type d 2>/dev/null \
    | sed 's#frontend/src/features/##' \
    | sort \
    | awk 'BEGIN { sep = "" } { printf "%s%s", sep, $0; sep = ", " } END { printf "\n" }'
else
  printf 'Features: none detected\n'
fi
printf 'Tests: %s frontend test files\n' "$(codex_files frontend/src | grep -E '\.(test|spec)\.(ts|tsx|js|jsx)$' | wc -l | tr -d ' ')"

codex_heading "Backend"
printf 'App: backend/app\n'
printf 'Entry: backend/app/main.py\n'
printf 'Routers: backend/app/routers\n'
printf 'Services: backend/app/services\n'
printf 'Models: backend/app/models\n'
printf 'Tests: %s backend test files\n' "$(codex_files backend/tests | grep -E 'test_.*\.py$' | wc -l | tr -d ' ')"

codex_heading "Docs"
printf 'MkDocs config: doc/mkdocs.yml\n'
printf 'Developer docs: doc/docs/developer\n'
printf 'User docs: doc/docs/user\n'
printf 'Ops docs: doc/docs/ops\n'

codex_heading "Useful next commands"
printf 'tools/codex/frontend-map.sh\n'
printf 'tools/codex/backend-map.sh\n'
printf 'tools/codex/docs-map.sh\n'
printf 'tools/codex/search-symbol.sh <query>\n'
printf 'tools/codex/test-target.sh <path-or-keyword>\n'

#!/usr/bin/env bash
# Summarize backend FastAPI structure, routers, services, models, and tests.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
codex_cd_root

printf '# Backend map\n'

codex_heading "Core files"
for file in backend/app/main.py backend/app/core/config.py backend/app/core/database.py backend/requirements.txt backend/requirements-test.txt backend/alembic.ini backend/pytest.ini; do
  [ -f "$file" ] && printf '%s\n' "$file"
done

codex_heading "Backend areas"
find backend/app -maxdepth 2 -type d ! -path '*/__pycache__*' 2>/dev/null \
  | sort \
  | sed 's#^#- #' \
  | codex_limit 120

codex_heading "Registered routers"
codex_search 'include_router' backend/app/main.py | codex_limit 140

codex_heading "Router prefixes and endpoints"
codex_search 'router = APIRouter|@router\.(get|post|put|delete|patch)' backend/app/routers | codex_limit 180

codex_heading "Models and schemas"
codex_files backend/app/models backend/app/db 2>/dev/null | sort | codex_limit 140

codex_heading "Services"
codex_files backend/app/services 2>/dev/null | sort | codex_limit 140

codex_heading "Related tests"
codex_files backend/tests 2>/dev/null | grep -E 'test_.*\.py$' | sort | codex_limit 160

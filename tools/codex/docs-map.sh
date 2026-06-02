#!/usr/bin/env bash
# List existing documentation entry points without generating new docs.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
codex_cd_root

printf '# Documentation map\n'

codex_heading "Docs config"
for file in doc/README.md doc/mkdocs.yml doc/requirements.txt README.md AGENTS.md; do
  [ -f "$file" ] && printf '%s\n' "$file"
done

codex_heading "Architecture and conventions"
for file in \
  doc/docs/developer/ai-assistant-guidelines.md \
  doc/docs/developer/architecture-overview.md \
  doc/docs/developer/architecture-frontend.md \
  doc/docs/developer/architecture-backend.md \
  doc/docs/developer/architecture-database.md \
  doc/docs/developer/repo-layout.md \
  doc/docs/developer/local-development.md \
  doc/docs/developer/contributing.md \
  doc/docs/developer/identity-and-execution-model.md \
  doc/docs/developer/workspace-surface-separation.md \
  doc/docs/developer/api-reference.md; do
  [ -f "$file" ] && printf '%s\n' "$file"
done

codex_heading "User workflow docs"
codex_files doc/docs/user 2>/dev/null | sort | codex_limit 120

codex_heading "Operations docs"
codex_files doc/docs/ops 2>/dev/null | sort | codex_limit 120

codex_heading "Docs maintenance"
for file in doc/docs/developer/docs-maintenance.md doc/docs/user/screenshots-gallery.md frontend/scripts/docs-screenshots/scenarios.ts frontend/scripts/docs-screenshots/fixtures/base.ts; do
  [ -f "$file" ] && printf '%s\n' "$file"
done

#!/usr/bin/env bash
# Search code/docs for a symbol, route, hook, slice, endpoint, or keyword.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
codex_cd_root

if [ "${1:-}" = "" ]; then
  printf 'Usage: tools/codex/search-symbol.sh <query>\n' >&2
  exit 2
fi

query="$*"
printf '# Search: %s\n' "$query"
printf 'Excluding generated/vendor/heavy files. Showing first 200 matches.\n'

codex_search "$query" . | codex_limit 200

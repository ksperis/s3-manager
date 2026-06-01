#!/usr/bin/env bash
# Detect Redux Toolkit and RTK Query artifacts in the frontend.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
codex_cd_root

summary=0
if [ "${1:-}" = "--summary" ]; then
  summary=1
fi

print_matches() {
  local title="$1"
  local pattern="$2"
  local limit="${3:-80}"
  codex_heading "$title"
  local matches
  matches="$(codex_search "$pattern" frontend/src frontend/package.json | codex_limit "$limit")"
  if [ -n "$matches" ]; then
    printf '%s\n' "$matches"
  else
    printf 'No matches detected.\n'
  fi
}

if [ "$summary" -eq 1 ]; then
  if codex_search '@reduxjs/toolkit|react-redux|\bconfigureStore\b|\bcreateSlice\b|\bcreateApi\b|\bfetchBaseQuery\b|\binjectEndpoints\b' frontend/src frontend/package.json | grep -q .; then
    printf 'RTK/RTK Query signals detected. Run tools/codex/rtk-map.sh for details.\n'
  else
    printf 'No Redux Toolkit or RTK Query artifacts detected in frontend/src.\n'
  fi
  exit 0
fi

printf '# Redux Toolkit / RTK Query map\n'
printf 'Scope: frontend/src and frontend/package.json\n'

print_matches "Store setup" '@reduxjs/toolkit|react-redux|\bconfigureStore\b|<Provider store=|Provider store=' 80
print_matches "Slices and reducers" '\bcreateSlice\b|\bcreateReducer\b|extraReducers|reducers:' 120
print_matches "Actions, thunks, selectors" '\bcreateAction\b|\bcreateAsyncThunk\b|\bcreateSelector\b|export const select[A-Z][A-Za-z0-9_]+|const select[A-Z][A-Za-z0-9_]+ *= *\(.*state' 120
print_matches "RTK Query APIs" '\bcreateApi\b|\bfetchBaseQuery\b|\binjectEndpoints\b|tagTypes|endpoints:\s*\(' 120
print_matches "Generated RTK Query hooks" 'use[A-Z][A-Za-z0-9]+(Query|Mutation|LazyQuery)' 120

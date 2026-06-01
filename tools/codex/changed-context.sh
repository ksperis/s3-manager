#!/usr/bin/env bash
# Show compact context around locally changed files without dumping full diffs.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
codex_cd_root

printf '# Changed context\n'

codex_heading "Git status"
git status --short --untracked-files=all

codex_heading "Diff stat"
git diff --stat
if ! git diff --cached --quiet; then
  printf '\n# Staged diff stat\n'
  git diff --cached --stat
fi

changed_files="$(git status --short --untracked-files=all | awk '{print $NF}' | sed 's#^"##; s#"$##' | sort -u)"

codex_heading "Changed files"
if [ -n "$changed_files" ]; then
  printf '%s\n' "$changed_files"
else
  printf 'No local changes.\n'
  exit 0
fi

codex_heading "Touched frontend routes/components/API"
frontend_files="$(printf '%s\n' "$changed_files" | grep -E '^frontend/src/' || true)"
if [ -n "$frontend_files" ]; then
  printf '%s\n' "$frontend_files" | while IFS= read -r file; do
    [ -f "$file" ] || continue
    matches="$(codex_search '<Route path=|export default function|export function|function [A-Z][A-Za-z0-9_]*|async function|export async function|use[A-Z][A-Za-z0-9_]*' "$file" | codex_limit 12)"
    [ -n "$matches" ] && printf '\n%s\n%s\n' "$file" "$matches"
  done
else
  printf 'No changed frontend source files.\n'
fi

codex_heading "Touched backend routes/services/models"
backend_files="$(printf '%s\n' "$changed_files" | grep -E '^backend/app/' || true)"
if [ -n "$backend_files" ]; then
  printf '%s\n' "$backend_files" | while IFS= read -r file; do
    [ -f "$file" ] || continue
    matches="$(codex_search 'router = APIRouter|@router\.|class [A-Z]|def [a-zA-Z_]|async def [a-zA-Z_]' "$file" | codex_limit 12)"
    [ -n "$matches" ] && printf '\n%s\n%s\n' "$file" "$matches"
  done
else
  printf 'No changed backend app files.\n'
fi

codex_heading "Touched Redux Toolkit signals"
if [ -n "$frontend_files" ]; then
  printf '%s\n' "$frontend_files" | while IFS= read -r file; do
    [ -f "$file" ] || continue
    matches="$(codex_search '\bconfigureStore\b|\bcreateSlice\b|\bcreateApi\b|\bfetchBaseQuery\b|\binjectEndpoints\b|\bcreateSelector\b|\bcreateAsyncThunk\b' "$file" | codex_limit 8)"
    [ -n "$matches" ] && printf '\n%s\n%s\n' "$file" "$matches"
  done
else
  printf 'No changed frontend source files.\n'
fi

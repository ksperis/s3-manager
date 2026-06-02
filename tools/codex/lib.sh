#!/usr/bin/env bash
# Shared helpers for the local Codex exploration toolkit.

set -euo pipefail

codex_cd_root() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  cd "$root"
}

codex_have() {
  command -v "$1" >/dev/null 2>&1
}

CODEX_RG_GLOBS=(
  -g '!**/.git/**'
  -g '!**/node_modules/**'
  -g '!**/dist/**'
  -g '!**/build/**'
  -g '!**/coverage/**'
  -g '!**/.pytest_cache/**'
  -g '!**/.mypy_cache/**'
  -g '!**/.ruff_cache/**'
  -g '!**/__pycache__/**'
  -g '!**/playwright-report/**'
  -g '!**/test-results/**'
  -g '!**/gl-test-reports/**'
  -g '!**/.venv/**'
  -g '!**/.browser-e2e-runtime/**'
  -g '!**/*.lock'
  -g '!**/package-lock.json'
  -g '!**/yarn.lock'
  -g '!**/pnpm-lock.yaml'
  -g '!**/*.db'
  -g '!**/*.db-shm'
  -g '!**/*.db-wal'
  -g '!**/coverage.xml'
)

codex_files() {
  if codex_have rg; then
    rg --files "${CODEX_RG_GLOBS[@]}" "$@"
  else
    find "${@:-.}" \
      \( -path '*/.git' -o -path '*/node_modules' -o -path '*/dist' -o -path '*/build' \
      -o -path '*/coverage' -o -path '*/.pytest_cache' -o -path '*/.mypy_cache' \
      -o -path '*/.ruff_cache' -o -path '*/__pycache__' -o -path '*/playwright-report' \
      -o -path '*/test-results' -o -path '*/gl-test-reports' -o -path '*/.venv' \
      -o -path '*/.browser-e2e-runtime' \) -prune \
      -o -type f ! -name '*.lock' ! -name 'package-lock.json' ! -name 'yarn.lock' \
      ! -name 'pnpm-lock.yaml' ! -name '*.db' ! -name '*.db-shm' ! -name '*.db-wal' \
      ! -name 'coverage.xml' -print
  fi
}

codex_search() {
  local pattern="$1"
  shift || true
  if codex_have rg; then
    rg -n --smart-case "${CODEX_RG_GLOBS[@]}" "$pattern" "${@:-.}" || true
  else
    grep -RInE \
      --exclude='*.lock' --exclude='package-lock.json' --exclude='yarn.lock' \
      --exclude='pnpm-lock.yaml' --exclude='*.db' --exclude='*.db-shm' \
      --exclude='*.db-wal' --exclude='coverage.xml' \
      --exclude-dir='.git' --exclude-dir='node_modules' --exclude-dir='dist' \
      --exclude-dir='build' --exclude-dir='coverage' --exclude-dir='.pytest_cache' \
      --exclude-dir='.mypy_cache' --exclude-dir='.ruff_cache' --exclude-dir='__pycache__' \
      --exclude-dir='playwright-report' --exclude-dir='test-results' \
      --exclude-dir='gl-test-reports' --exclude-dir='.venv' \
      --exclude-dir='.browser-e2e-runtime' "$pattern" "${@:-.}" || true
  fi
}

codex_heading() {
  printf '\n## %s\n' "$1"
}

codex_count_files() {
  local path="$1"
  if [ ! -e "$path" ]; then
    printf '0'
    return
  fi
  codex_files "$path" | wc -l | tr -d ' '
}

codex_limit() {
  local max="${1:-80}"
  sed -n "1,${max}p"
}

#!/usr/bin/env bash
# Identify and run focused tests for a file path or keyword.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
codex_cd_root

if [ "${1:-}" = "" ]; then
  printf 'Usage: tools/codex/test-target.sh <path-or-keyword>\n' >&2
  exit 2
fi

target="$1"

run_frontend_tests() {
  local tests="$1"
  if [ -z "$tests" ]; then
    return 1
  fi
  if [ ! -f frontend/package.json ] || ! codex_have npm; then
    printf 'npm or frontend/package.json not available; cannot run frontend tests.\n' >&2
    return 1
  fi
  local args
  args="$(printf '%s\n' "$tests" | sed 's#^frontend/##' | paste -sd ' ' -)"
  printf 'Running frontend target: cd frontend && npm run test -- %s\n' "$args"
  (cd frontend && npm run test -- $args)
}

run_backend_tests() {
  local tests="$1"
  if [ -z "$tests" ]; then
    return 1
  fi
  if ! codex_have pytest; then
    printf 'pytest not available; cannot run backend tests.\n' >&2
    return 1
  fi
  local args
  args="$(printf '%s\n' "$tests" | sed 's#^backend/##' | paste -sd ' ' -)"
  printf 'Running backend target: cd backend && PYTHONPATH=. pytest %s -q\n' "$args"
  (cd backend && PYTHONPATH=. pytest $args -q)
}

frontend_related_tests() {
  local key="$1"
  local stem
  local stem_regex
  stem="$(basename "$key" | sed -E 's/\.(test|spec)\.(ts|tsx|js|jsx)$//; s/\.(ts|tsx|js|jsx)$//')"
  stem_regex="$(printf '%s' "$stem" | sed -E 's/[][\\.^$*+?{}()|/]/\\&/g')"
  {
    codex_files frontend/src 2>/dev/null | grep -E "(${stem_regex}.*|.*${stem_regex}).*\.(test|spec)\.(ts|tsx|js|jsx)$" || true
    codex_search "$stem" frontend/src 2>/dev/null | awk -F: '/\.(test|spec)\.(ts|tsx|js|jsx):/ {print $1}' || true
  } | sort -u | codex_limit 20
}

backend_related_tests() {
  local key="$1"
  local stem
  stem="$(basename "$key" .py)"
  stem="$(printf '%s' "$stem" | sed -E 's/(_service|_router|_model)$//')"
  {
    codex_files backend/tests 2>/dev/null | grep -E "test_.*${stem}.*\.py$|test_${stem}.*\.py$" || true
    codex_search "$stem" backend/tests 2>/dev/null | awk -F: '/test_.*\.py:/ {print $1}' || true
  } | sort -u | codex_limit 20
}

if [ -e "$target" ]; then
  if printf '%s\n' "$target" | grep -Eq '^frontend/.*\.(test|spec)\.(ts|tsx|js|jsx)$'; then
    run_frontend_tests "$target"
    exit $?
  fi

  if printf '%s\n' "$target" | grep -Eq '^backend/tests/.*test_.*\.py$'; then
    run_backend_tests "$target"
    exit $?
  fi

  case "$target" in
    frontend/src/*|frontend/scripts/*|frontend/e2e/*)
      tests="$(frontend_related_tests "$target")"
      if run_frontend_tests "$tests"; then exit 0; fi
      printf 'No focused frontend tests found for %s.\n' "$target" >&2
      exit 1
      ;;
    backend/app/*.py|backend/app/*/*.py|backend/app/*/*/*.py)
      tests="$(backend_related_tests "$target")"
      if run_backend_tests "$tests"; then exit 0; fi
      printf 'No focused backend tests found for %s.\n' "$target" >&2
      exit 1
      ;;
    doc/*)
      if [ -f frontend/package.json ] && codex_have npm; then
        printf 'Running docs screenshot registry check.\n'
        (cd frontend && npm run docs:screenshots:check)
        exit $?
      fi
      ;;
  esac
fi

frontend_tests="$(frontend_related_tests "$target")"
backend_tests="$(backend_related_tests "$target")"
ran=0

if [ -n "$frontend_tests" ]; then
  run_frontend_tests "$frontend_tests"
  ran=1
fi

if [ -n "$backend_tests" ]; then
  run_backend_tests "$backend_tests"
  ran=1
fi

if [ "$ran" -eq 0 ]; then
  printf 'No focused tests found for "%s". Try tools/codex/search-symbol.sh first.\n' "$target" >&2
  exit 1
fi

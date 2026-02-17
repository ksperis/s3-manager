#!/bin/sh
set -eu

runtime_env_file="${SCHEDULER_RUNTIME_ENV_FILE:-/tmp/s3-manager-scheduler.env}"
if [ -f "$runtime_env_file" ]; then
  # shellcheck disable=SC1090
  . "$runtime_env_file"
fi

: "${BACKEND_API_BASE:?BACKEND_API_BASE is required}"
: "${INTERNAL_CRON_TOKEN:?INTERNAL_CRON_TOKEN is required}"

day_offset="${BILLING_DAY_OFFSET:-1}"
case "$day_offset" in
  ''|*[!0-9]*)
    echo "BILLING_DAY_OFFSET must be an integer >= 0" >&2
    exit 1
    ;;
esac

target_day="$(date -u -d "${day_offset} day ago" +%F)"

curl \
  --fail \
  --silent \
  --show-error \
  --max-time "${CRON_HTTP_TIMEOUT_SECONDS:-30}" \
  -X POST \
  "${BACKEND_API_BASE}/internal/billing/collect/daily?day=${target_day}" \
  -H "X-Internal-Token: ${INTERNAL_CRON_TOKEN}"
echo

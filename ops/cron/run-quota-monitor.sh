#!/bin/sh
set -eu

runtime_env_file="${SCHEDULER_RUNTIME_ENV_FILE:-/tmp/s3-manager-scheduler.env}"
if [ -f "$runtime_env_file" ]; then
  # shellcheck disable=SC1090
  . "$runtime_env_file"
fi

: "${BACKEND_API_BASE:?BACKEND_API_BASE is required}"
: "${INTERNAL_CRON_TOKEN:?INTERNAL_CRON_TOKEN is required}"

curl \
  --fail \
  --silent \
  --show-error \
  --max-time "${CRON_HTTP_TIMEOUT_SECONDS:-30}" \
  -X POST \
  "${BACKEND_API_BASE}/internal/quota-monitor/run" \
  -H "X-Internal-Token: ${INTERNAL_CRON_TOKEN}"
echo

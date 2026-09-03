#!/bin/sh
set -eu

crontab_file="${SCHEDULER_CRONTAB_FILE:-/tmp/bucketreef.crontab}"

umask 077
: "${BACKEND_API_BASE:?BACKEND_API_BASE is required}"
: "${INTERNAL_CRON_TOKEN:?INTERNAL_CRON_TOKEN is required}"

{
  echo 'SHELL=/bin/sh'
  echo 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  echo "$HEALTHCHECK_CRON_SCHEDULE /bin/sh /opt/cron/run-healthcheck.sh"
  echo "$BILLING_CRON_SCHEDULE /bin/sh /opt/cron/run-billing.sh"
  echo "$QUOTA_MONITOR_CRON_SCHEDULE /bin/sh /opt/cron/run-quota-monitor.sh"
  echo "$USAGE_HISTORY_CRON_SCHEDULE /bin/sh /opt/cron/run-usage-history.sh"
  echo "${NOTIFICATION_RETENTION_CRON_SCHEDULE:-15 3 * * *} /bin/sh /opt/cron/run-notification-retention.sh"
} > "$crontab_file"

exec supercronic "$crontab_file"

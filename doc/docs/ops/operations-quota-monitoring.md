# Operations: Quota Monitoring and History

Quota monitoring supervises `S3Account` and `S3User` usage for quota alerts.
Usage history stores the same managed-account scope once per day.

Current scope:

- quota alerts by email
- quota alerts in the topbar notification menu
- usage history storage for managed `S3Account` and `S3User` subjects

Out of scope:

- S3 Connection quota supervision

## Enablement model

Enable from Admin settings:

- `general.quota_alerts_enabled`
- `general.usage_history_enabled`

User-level preferences:

- `/users/me.quota_alerts_enabled` (default `true`, email delivery only)
- `/users/me.quota_alerts_global_watch` (default `false`, admin-like roles only)

Topbar quota notifications are created by the quota monitor for active users
who have effective `account_administrator` Manager access or `portal_manager`
Portal access to the affected account. Both direct and group associations are
resolved, and a user holding both roles receives only one notification. Users
linked to the affected RGW user and admin-like global watchers keep their
existing visibility. Global watchers receive the in-app notification even when
they disable quota alert emails.

The same account recipient expansion applies to email alerts. Email delivery
continues to require the user's `quota_alerts_enabled` preference. Visibility is
revalidated when notifications are listed, so revoking the relevant account,
group, or RGW-user access also hides older quota alerts.

## SMTP configuration

SMTP non-secret fields are in app settings (`quota_notifications`).

SMTP password is runtime-only:

- `SMTP_PASSWORD`

If SMTP is incomplete, quota runs continue and alert emails are skipped.

Deployment notes:

- Docker Compose: set `SMTP_PASSWORD` in `.env`.
- Helm: inject `SMTP_PASSWORD` through backend environment overrides/secrets policy used in your cluster.

## Manual run

```bash
curl -X POST "http://localhost:8000/api/internal/quota-monitor/run" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

Quota monitor runs do not persist usage history snapshots. To run the daily
managed usage collection manually:

```bash
curl -X POST "http://localhost:8000/api/internal/usage-history/collect" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

## SMTP test from UI

Admin General Settings includes a `Send test email` action in the quota SMTP section.

Backend API used by UI:

`POST /api/admin/settings/quota-notifications/test-email`

The test email is sent to the currently authenticated superadmin account email.

## Scheduler integration

- Docker Compose scheduler includes a quota monitor job (`QUOTA_MONITOR_CRON_SCHEDULE`, default `0 * * * *`) and a usage history job (`USAGE_HISTORY_CRON_SCHEDULE`, default `0 3 * * *`).
- Helm chart supports `quotaMonitorCronJob` and `usageHistoryCronJob` values (`enabled`, `schedule`, token, extra env).

## History and retention

History model:

- `quota_usage_hourly` stores the timestamped detail for each usage collection run and subject
- `quota_usage_daily` stores the daily rollup for long-term trends

Shared retention service (`DataRetentionService`) is used by quota and billing jobs.

Retention env vars:

- `QUOTA_HISTORY_HOURLY_RETENTION_DAYS` (default `30`)
- `QUOTA_HISTORY_DAILY_RETENTION_DAYS` (default `365`)
- `BILLING_DAILY_RETENTION_DAYS` (default `365`)

Set retention to `0` to disable purge for the corresponding dataset.

User notification retention is separate. `USER_NOTIFICATIONS_RETENTION_DAYS`
defaults to `90`, applies to read and unread notifications, and accepts `0` to
disable the purge. The notification purge runs through
`POST /api/internal/notifications/purge`. Compose schedules it daily with
`NOTIFICATION_RETENTION_CRON_SCHEDULE`; Helm uses
`notificationRetentionCronJob`. The internal endpoint is token- and
lease-protected and reports the number of deleted rows.

## Alert semantics

- Threshold default: `85%`
- Evaluated ratio: `max(bytes%, objects%)`
- Alerting mode: crossing-only (`normal -> threshold -> full`)
- First run sends immediate alert if already above threshold or full
- In-app notifications use the same transitions and can be marked read per user.

## Related pages

- [Configuration](configuration.md)
- [Operations: billing](operations-billing.md)
- [Operations: observability](operations-observability.md)

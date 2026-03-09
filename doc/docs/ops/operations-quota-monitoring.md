# Operations: Quota Monitoring and History

Quota monitoring supervises `S3Account` and `S3User` usage with hourly polling.

Current scope:

- quota alerts by email
- usage history storage (hourly + daily rollup)

Out of scope:

- S3 Connection quota supervision

## Enablement model

Enable from Admin settings:

- `general.quota_alerts_enabled`
- `general.usage_history_enabled`

User-level preferences:

- `/users/me.quota_alerts_enabled` (default `true`)
- `/users/me.quota_alerts_global_watch` (default `false`, admin-like roles only)

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

## SMTP test from UI

Admin General Settings includes a `Send test email` action in the quota SMTP section.

Backend API used by UI:

`POST /api/admin/settings/quota-notifications/test-email`

The test email is sent to the currently authenticated superadmin account email.

## Scheduler integration

- Docker Compose scheduler includes a quota monitor job (`QUOTA_MONITOR_CRON_SCHEDULE`, default `0 * * * *`).
- Helm chart supports `quotaMonitorCronJob` values (`enabled`, `schedule`, token, extra env).

## History and retention

Hybrid history model:

- `quota_usage_hourly` for short-term detail
- `quota_usage_daily` for long-term rollups

Shared retention service (`DataRetentionService`) is used by quota and billing jobs.

Retention env vars:

- `QUOTA_HISTORY_HOURLY_RETENTION_DAYS` (default `30`)
- `QUOTA_HISTORY_DAILY_RETENTION_DAYS` (default `365`)
- `BILLING_DAILY_RETENTION_DAYS` (default `365`)

Set retention to `0` to disable purge for the corresponding dataset.

## Alert semantics

- Threshold default: `85%`
- Evaluated ratio: `max(bytes%, objects%)`
- Alerting mode: crossing-only (`normal -> threshold -> full`)
- First run sends immediate alert if already above threshold or full

## Related pages

- [Configuration](configuration.md)
- [Operations: billing](operations-billing.md)
- [Operations: observability](operations-observability.md)

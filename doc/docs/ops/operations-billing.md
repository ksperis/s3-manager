# Operations: Billing

Billing collection is disabled by default and must be enabled explicitly.

## Enablement model

Billing requires both:

1. Global runtime switch: `BILLING_ENABLED=true`.
2. UI app setting: `billing_enabled=true`.

## Manual daily collection

```bash
curl -X POST "http://localhost:8000/api/internal/billing/collect/daily?day=YYYY-MM-DD" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

## Scheduler integration

- Compose scheduler calls daily collection with configurable day offset.
- Helm supports `billingCronJob` values (`schedule`, `dayOffset`, token).

## Retention

Billing daily tables are purged by the shared `DataRetentionService` (used by billing and quota jobs).

- `BILLING_DAILY_RETENTION_DAYS` (default `365`)
- `0` disables billing purge

## Related pages

- [Operations: API tokens](operations-api-tokens.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)
- [Operations: observability](operations-observability.md)

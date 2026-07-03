# Operations: Billing

Billing collection is disabled by default and must be enabled explicitly.

## Enablement model

Billing requires both:

1. Global runtime switch: `BILLING_ENABLED=true`.
2. UI app setting: `billing_enabled=true`.

The Portal Billing tab is shown only when the UI app setting is enabled. When it is disabled, Portal does not call the billing source endpoint.

## Rate cards

Billing cost estimates require an existing rate card. The service resolves rate cards in this order:

1. Explicit account or S3 user assignment.
2. Endpoint-specific rate card valid for the billing period.
3. Global default rate card valid for the billing period.
4. `BILLING_DEFAULT_RATE_CARD_NAME`, when configured.

Without a matching rate card, Admin and Portal still show storage, traffic, request, and coverage data, but estimated costs are unavailable.

## Manual daily collection

```bash
curl -X POST "http://localhost:8000/api/internal/billing/collect/daily?day=YYYY-MM-DD" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

Admins can also trigger one UTC day from `/admin/billing`. The result reports endpoint count, storage records, usage records, and partial collection errors.

## Coverage

Billing coverage is tracked separately for storage snapshots and RGW usage logs.
The UI shows both source counts when they differ, because a month can have storage data without usage traffic, or usage traffic without a storage snapshot.
Treat estimated costs as provisional when coverage is low or source counts do not match.

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

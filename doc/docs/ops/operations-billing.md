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

## Related pages

- [Operations: API tokens](operations-api-tokens.md)
- [Operations: observability](operations-observability.md)

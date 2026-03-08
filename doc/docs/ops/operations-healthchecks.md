# Operations: Endpoint Healthchecks

Endpoint healthchecks probe storage endpoints and persist status/latency history.

## Manual trigger

```bash
curl -X POST "http://localhost:8000/api/internal/healthchecks/run" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

## Scheduler integration

- Compose scheduler calls the internal endpoint periodically.
- Helm supports `healthcheckCronJob` values.

## Relevant backend settings

- `HEALTHCHECK_ENABLED`
- `HEALTHCHECK_TIMEOUT_SECONDS`
- `HEALTHCHECK_INTERVAL_SECONDS`
- `HEALTHCHECK_RETENTION_DAYS`
- `HEALTHCHECK_DEGRADED_LATENCY_MS`
- `HEALTHCHECK_VERIFY_SSL`

## UI dependency

`Endpoint Status` pages require `endpoint_status_enabled` in app settings.

## Related pages

- [Operations: observability](operations-observability.md)
- [Operations: billing](operations-billing.md)

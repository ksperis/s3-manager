# Endpoint Healthchecks

Healthchecks provide a simple HTTP probe for each configured storage endpoint. By default, the scheduler should run every 5 minutes and store:

- Raw checks for 30 days
- Daily aggregates for long-term charts

## Internal Run (Cron)

Trigger a run manually:

```bash
curl -X POST "http://localhost:8000/api/internal/healthchecks/run" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

## Helm (recommended)

Enable the built-in cronjob:

```yaml
backend:
  env:
    INTERNAL_CRON_TOKEN: "change-me-strong"

healthcheckCronJob:
  enabled: true
  schedule: "*/5 * * * *"
```

## Docker Compose / Local Cron

Use any scheduler (cron, task runner, etc.) to call the internal endpoint.
Make sure `INTERNAL_CRON_TOKEN` is set on the backend container.

## Environment Variables

```bash
HEALTHCHECK_ENABLED=true
HEALTHCHECK_TIMEOUT_SECONDS=5
HEALTHCHECK_INTERVAL_SECONDS=300
HEALTHCHECK_RETENTION_DAYS=30
HEALTHCHECK_DEGRADED_LATENCY_MS=2000
HEALTHCHECK_VERIFY_SSL=true
```

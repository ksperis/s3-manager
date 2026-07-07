# Operations: Endpoint Healthchecks

Endpoint healthchecks probe storage endpoints and persist status, latency, and
incident history for Admin, Manager, Portal, and Ceph Admin status views.

## Availability model

- The effective feature switch is `endpoint_status_enabled` in app settings.
- `FEATURE_ENDPOINT_STATUS_ENABLED` can force that switch on or off from the
  backend environment.
- Each storage endpoint can select a healthcheck mode and optional probe URL
  from Admin **Storage Backends**.
- `HEALTHCHECK_ENABLED` is a legacy runtime setting and is not the feature-lock
  mechanism. Prefer `endpoint_status_enabled` or `FEATURE_ENDPOINT_STATUS_ENABLED`
  when deciding whether the product should collect and show endpoint status.

## Manual trigger

```bash
curl -X POST "http://localhost:8000/api/internal/healthchecks/run" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

The endpoint returns `skipped` when another backend replica already holds the
healthcheck operation lease.

## Scheduler integration

- Compose scheduler calls the internal endpoint periodically.
- Helm supports `healthcheckCronJob` values.

The scheduler or CronJob must use the same `INTERNAL_CRON_TOKEN` as the backend.
Keep the internal route on a trusted network.

## Per-endpoint mode

Admin **Storage Backends** exposes:

- **HTTP probe**: checks the endpoint or a configured healthcheck URL.
- **S3 signed probe**: signs a lightweight S3 request with supervision or admin
  credentials. This mode is available for Ceph endpoints when suitable
  credentials are configured.
- Optional healthcheck URL override. Empty value uses the endpoint URL.

## Relevant backend settings

- `HEALTHCHECK_TIMEOUT_SECONDS`
- `HEALTHCHECK_INTERVAL_SECONDS`
- `HEALTHCHECK_RETENTION_DAYS`
- `HEALTHCHECK_DEGRADED_LATENCY_MS`
- `HEALTHCHECK_VERIFY_SSL`
- `HEALTHCHECK_LATENCY_BASELINE_WINDOW_DAYS`
- `HEALTHCHECK_BASELINE_SAMPLE_SIZE`
- `HEALTHCHECK_RELATIVE_DEGRADED_RATIO`
- `HEALTHCHECK_RELATIVE_DEGRADED_MIN_DELTA_MS`
- `HEALTHCHECK_INCIDENT_RECENT_MINUTES`

## UI dependency

`Endpoint Status` pages and dashboard health widgets require
`endpoint_status_enabled` in app settings. When the feature is disabled,
scheduled runs fail fast instead of writing new healthcheck rows.

## Related pages

- [Feature: Endpoint Status in Admin](../user/feature-endpoint-status-admin.md)
- [Configuration](configuration.md)
- [Operations: observability](operations-observability.md)
- [Operations: billing](operations-billing.md)

# Deploy with Docker Compose

Use Docker Compose for quick local or validation deployments.

## Prebuilt images

```bash
git clone https://github.com/ksperis/s3-manager.git
cd s3-manager
S3_MANAGER_TAG=latest docker compose up
```

`latest` resolves to the latest stable release published from a Git tag.

## Build from source

From repository root:

```bash
docker compose -f docker-compose.build.yml up --build
```

## Default endpoints

- Frontend: `http://localhost:8080`
- API base: `http://localhost:8000/api`
- OpenAPI: `http://localhost:8000/docs`

## Scheduler service

The compose stack includes a `scheduler` container that triggers:

- endpoint healthchecks (default every 5 minutes)
- billing daily collection (default `02:00 UTC`, day offset `1`)
- quota monitoring for alerts (default every hour)
- usage history collection for managed accounts and S3 users (default `03:00 UTC`)

Set a strong shared token in `.env`:

```bash
INTERNAL_CRON_TOKEN=change-me-strong
```

Main scheduler knobs:

- `HEALTHCHECK_CRON_SCHEDULE`
- `BILLING_CRON_SCHEDULE`
- `QUOTA_MONITOR_CRON_SCHEDULE`
- `USAGE_HISTORY_CRON_SCHEDULE`
- `BILLING_DAY_OFFSET`

History retention / SMTP knobs:

- `BILLING_DAILY_RETENTION_DAYS`
- `QUOTA_HISTORY_HOURLY_RETENTION_DAYS`
- `QUOTA_HISTORY_DAILY_RETENTION_DAYS`
- `SMTP_PASSWORD`

LDAP is configured on the backend with `LDAP_PROVIDERS__<key>__...`
environment variables. Put bind passwords in your local `.env` or secret
injection mechanism, use provider keys matching `[a-z0-9_-]+`, and use LDAPS
or StartTLS for non-lab deployments. `TLS_VERIFY=false`,
`ALLOW_INSECURE=true`, and `ALLOW_EMAIL_LINKING=true` emit startup security
warnings.

## Related pages

- [Configuration](configuration.md)
- [Operations: healthchecks](operations-healthchecks.md)
- [Operations: billing](operations-billing.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)

# Deploy with Docker Compose

Use Docker Compose for single-host or production-like validation deployments.
For a loopback-only evaluation with generated secrets, start with
[Local quickstart](quickstart.md).

## Prebuilt images

```bash
git clone https://github.com/ksperis/bucketreef.git
cd bucketreef
# Configure strong secrets and origins in .env first.
export INTERNAL_CRON_TOKEN="$(openssl rand -hex 48)"
BUCKETREEF_TAG=latest docker compose up -d backend frontend
```

`latest` resolves to the latest stable release published from a Git tag.

## Which image tag should I use?

| Use case | Tag |
|---|---|
| Quick stable validation | `latest` |
| Reproducible validation | a plain semver tag such as `0.2.1` |
| Internal rolling lab | `dev` from the internal GitLab registry |
| Debugging a specific internal build | `dev-<short-sha>` from the internal GitLab registry |

## Build from source

From repository root:

```bash
export INTERNAL_CRON_TOKEN="$(openssl rand -hex 48)"
docker compose -f docker-compose.build.yml up --build
```

Unlike the local `./quickstart`, this command does not generate or persist the
other required application secrets for you. Configure the complete `.env`
contract before using it beyond an isolated development check.

## Default endpoints

- Frontend: `http://localhost:8080`
- API base through the frontend: `http://localhost:8080/api`
- Backend diagnostics on loopback only: `http://127.0.0.1:8000/docs`

## Scheduler service

The scheduler is in the opt-in `operations` profile. The local quickstart does
not activate it. A complete deployment starts it explicitly:

```bash
export INTERNAL_CRON_TOKEN="$(openssl rand -hex 48)"
docker compose --profile operations up -d
```

The scheduler triggers:

- endpoint healthchecks (default every 5 minutes)
- billing daily collection (default `02:00 UTC`, day offset `1`)
- quota monitoring for alerts (default every hour)
- usage history collection for managed accounts and S3 users (default `03:00 UTC`)

Persist the same strong shared token in `.env` or your secret manager:

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
`ALLOW_INSECURE=true`, and `ALLOW_LEGACY_TLS=true` are rejected by the
production security profile. Identity collisions require manual superadmin approval.

## Create the first administrator

BucketReef has no predefined administrator and never reads administrator
credentials from environment variables. After the backend is healthy, issue a
short-lived URL:

```bash
docker compose exec backend python -m app.scripts.issue_first_admin_bootstrap
```

The command refuses a non-empty user database, stores only a SHA-256 token
digest and prints a `PUBLIC_ORIGIN` URL whose token is in the fragment. Open it
within 15 minutes, create the super-administrator and enroll a passkey. If it
expires before use, run the command again to revoke it and issue another.

For a console-only fallback:

```bash
docker compose exec backend python -m app.scripts.create_first_admin \
  --email exact-admin@example.com \
  --full-name "Platform Admin"
```

Both methods are permanently unavailable once any user exists. Commands that
recover an existing super-administrator remain separate and do not reopen
initial setup.

## After deploy checklist

1. Issue the one-time bootstrap URL, create the first administrator and enroll
   its passkey, or use the direct CLI fallback.
2. Open the frontend and verify `/admin` after passkey authentication.
3. For production, set `APP_ENV=production`, distinct `UI_JWT_KEYS` and
   `API_JWT_KEYS`, `CREDENTIAL_KEYS`, the exact origin/hosts, secure cookies,
   WebAuthn, trusted proxy CIDRs, and the scheduler token in `.env`.
4. Optionally configure the first storage endpoint from **Admin > Storage Backends**.
5. Optionally create or import the first account or connection.
6. If storage is configured, run or wait for the first endpoint healthcheck.
7. Verify the Browser and Portal feature flags match the intended user rollout.
8. Open [User troubleshooting](../user/troubleshooting.md) and [Operations: observability](operations-observability.md) so support teams know what to capture.

## Related pages

- [Configuration](configuration.md)
- [Production readiness](production-readiness.md)
- [Backup and restore](backup-restore.md)
- [Operations: healthchecks](operations-healthchecks.md)
- [Operations: billing](operations-billing.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)
- [Operations: security](operations-security.md)

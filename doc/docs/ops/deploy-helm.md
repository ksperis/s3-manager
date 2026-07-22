# Deploy with Helm

Use Helm for Kubernetes deployments.

## Chart location

- Chart: `helm/s3-manager`
- Values: `helm/s3-manager/values.yaml`

## Minimal install

```bash
helm install s3-manager helm/s3-manager \
  --set image.backend.repository=ghcr.io/ksperis/s3-manager-backend \
  --set image.frontend.repository=ghcr.io/ksperis/s3-manager-frontend
```

## Current chart characteristics

- Backend and frontend Deployments + Services.
- Optional Ingress.
- Built-in CronJobs for billing, healthchecks, quota monitoring, and usage history collection.
- Optional bundled PostgreSQL in values (evaluate for your environment policies).
- CronJobs render with `concurrencyPolicy: Forbid`; the backend also uses database leases so a manual trigger and a CronJob cannot run the same collection at the same time.

Cron values blocks:

- `billingCronJob`
- `healthcheckCronJob`
- `quotaMonitorCronJob`
- `usageHistoryCronJob`

Backend env defaults include billing/quota retention knobs.
Provide `SMTP_PASSWORD` via your secret injection policy.
LDAP providers can be injected through `backend.extraEnv` with
`LDAP_PROVIDERS__<key>__...` variables. Store bind passwords in Kubernetes
Secrets or your external secret manager rather than plain values files. Use
provider keys matching `[a-z0-9_-]+`; `TLS_VERIFY=false`,
`ALLOW_INSECURE=true`, and `ALLOW_EMAIL_LINKING=true` emit startup security
warnings.

## Multi-backend profile

Running more than one backend replica is supported only with PostgreSQL as the
shared database source of truth. SQLite remains useful for local development and
single-backend deployments, but it is not a multi-backend contract.

For `backend.replicas > 1`:

- Enable `.Values.postgresql.enabled=true` or set `backend.env.DATABASE_URL` to
  a PostgreSQL URL.
- Prefer `backend.persistence.enabled=false`; the database stores live app
  settings and operational coordination. Keep backend persistence only for
  legacy imports or files that are explicitly shared.
- If backend persistence is enabled, use `ReadWriteMany`. The chart rejects
  `ReadWriteOnce` with multiple backend replicas.
- Enable each billing, healthcheck, quota-monitor, and usage-history CronJob
  once per release. The chart-level `concurrencyPolicy: Forbid` and backend DB
  leases protect against overlapping runs.

The chart injects `BACKEND_REPLICAS` into the backend container unless you set it
explicitly in `backend.env`; startup logs warn if multiple replicas are run on
SQLite outside Helm safeguards.

## Container images

Published images:

- `ghcr.io/ksperis/s3-manager-backend`
- `ghcr.io/ksperis/s3-manager-frontend`

These images are built, tested, scanned, and published by GitLab CI.
GitHub is treated as a code mirror and release metadata surface, not as a
second image build pipeline.

Registry roles:

- GitLab Container Registry: internal lab/dev images only
- GHCR: promoted stable/public images only

Tag conventions:

- lab and rolling internal validation: `dev`
- pinned lab validation build: `dev-<short-sha>`
- latest stable release: `latest`
- stable image release: plain semver such as `0.2.0`
- stable minor series alias: `0.2` for the latest `0.2.x` release
- Git release tag: `v0.2.0`

## Which image tag should I use?

| Use case | Tag |
|---|---|
| Stable production-like deployment | plain semver such as `0.2.0` |
| Track the latest stable release | `latest` |
| Stay on the latest patch of a minor line | minor alias such as `0.2` |
| Internal lab validation | `dev` from the GitLab Container Registry |
| Reproduce one internal build | `dev-<short-sha>` from the GitLab Container Registry |

Stable/public examples:

```bash
helm upgrade --install s3-manager helm/s3-manager \
  --set image.backend.repository=ghcr.io/ksperis/s3-manager-backend \
  --set image.backend.tag=latest \
  --set image.frontend.repository=ghcr.io/ksperis/s3-manager-frontend \
  --set image.frontend.tag=latest
```

```bash
helm upgrade --install s3-manager helm/s3-manager \
  --set image.backend.repository=ghcr.io/ksperis/s3-manager-backend \
  --set image.backend.tag=0.1.10 \
  --set image.frontend.repository=ghcr.io/ksperis/s3-manager-frontend \
  --set image.frontend.tag=0.1.10
```

```bash
helm upgrade --install s3-manager helm/s3-manager \
  --set image.backend.repository=ghcr.io/ksperis/s3-manager-backend \
  --set image.backend.tag=0.1 \
  --set image.frontend.repository=ghcr.io/ksperis/s3-manager-frontend \
  --set image.frontend.tag=0.1
```

Lab/dev example with GitLab Container Registry:

```bash
helm upgrade --install s3-manager helm/s3-manager \
  --set image.backend.repository=<gitlab-registry>/<project>/backend \
  --set image.backend.tag=dev \
  --set image.frontend.repository=<gitlab-registry>/<project>/frontend \
  --set image.frontend.tag=dev
```

## After deploy checklist

1. Confirm backend, frontend, and scheduler pods are running.
2. Confirm secrets are injected from Kubernetes Secrets or an external secret manager.
3. Open the frontend, sign in, and configure the first storage endpoint.
4. Create or import the first account or connection.
5. Verify the healthcheck CronJob runs and endpoint status updates.
6. Verify billing, quota monitoring, and usage-history CronJobs are enabled or intentionally disabled.
7. Check Browser and Portal feature flags before giving access to users.
8. Review [Operations: security](operations-security.md) and [Operations: observability](operations-observability.md) before publishing the URL broadly.

## Related pages

- [Configuration](configuration.md)
- [Production readiness](production-readiness.md)
- [Backup and restore](backup-restore.md)
- [Operations: healthchecks](operations-healthchecks.md)
- [Operations: billing](operations-billing.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)

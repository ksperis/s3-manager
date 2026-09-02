# Deploy with Helm

Use Helm for Kubernetes deployments.

## Chart location

- Chart: `helm/bucketreef`
- Values: `helm/bucketreef/values.yaml`

The chart defaults remain pinned to the latest stable application release
(`0.2.1`). They do not automatically follow an unpublished source checkout.
To validate checkout changes, override both backend and frontend repositories
and give both images the exact same immutable `dev-<short-sha>` tag.

## Minimal install

```bash
helm install bucketreef helm/bucketreef \
  --set backend.existingSecret=bucketreef-auth \
  --set-json 'backend.trustedProxyCidrs=["10.244.2.0/24"]' \
  --set image.backend.repository=ghcr.io/ksperis/bucketreef-backend \
  --set image.frontend.repository=ghcr.io/ksperis/bucketreef-frontend
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
`ALLOW_INSECURE=true` and `ALLOW_LEGACY_TLS=true` are rejected in production;
external-identity collisions use the manual approval queue.

The referenced existing Secret is mandatory and must provide the keys mapped
by `backend.secretKeys`: database URL, distinct UI/API JWT rings, credential
ring, and internal Cron token. Ingress must be enabled with an existing TLS
secret. Sensitive values in `backend.env` are rejected by chart rendering.

`backend.trustedProxyCidrs` is also mandatory. Set it to the narrow pod CIDR or
individual addresses actually used by your ingress/reverse-proxy path; the
chart serializes it to `TRUSTED_PROXY_CIDRS`. For example, if the ingress
controller pods are verified to use only `10.244.2.0/24`:

```yaml
backend:
  trustedProxyCidrs:
    - 10.244.2.0/24
```

Obtain the real controller pod addresses and cluster pod CIDRs from your
Kubernetes network configuration before choosing this value. Do not copy the
example blindly and do not use `0.0.0.0/0`, `::/0`, or a broad corporate CIDR.
Requests from peers outside this boundary ignore `X-Forwarded-For`.

## Create the first administrator

After the backend pod is ready, explicitly issue a one-time setup URL:

```bash
kubectl exec deploy/bucketreef-backend -- \
  python -m app.scripts.issue_first_admin_bootstrap
```

Ensure `PUBLIC_ORIGIN`, ingress TLS, WebAuthn origin/RP ID and trusted hosts are
already correct before opening the URL. The token expires after 15 minutes and
can be reissued only while the user database is empty. A console-only fallback
uses `app.scripts.create_first_admin` in the same pod. Helm does not inject a
default administrator or administrator password.

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

- `ghcr.io/ksperis/bucketreef-backend`
- `ghcr.io/ksperis/bucketreef-frontend`

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
- stable image release: plain semver such as `0.2.1`
- stable minor series alias: `0.2` for the latest `0.2.x` release
- Git release tag: `v0.2.1`

## Which image tag should I use?

| Use case | Tag |
|---|---|
| Stable production-like deployment | plain semver such as `0.2.1` |
| Track the latest stable release | `latest` |
| Stay on the latest patch of a minor line | minor alias such as `0.2` |
| Internal lab validation | `dev` from the GitLab Container Registry |
| Reproduce one internal build | `dev-<short-sha>` from the GitLab Container Registry |

Stable/public examples:

```bash
helm upgrade --install bucketreef helm/bucketreef \
  --set image.backend.repository=ghcr.io/ksperis/bucketreef-backend \
  --set image.backend.tag=latest \
  --set image.frontend.repository=ghcr.io/ksperis/bucketreef-frontend \
  --set image.frontend.tag=latest
```

```bash
helm upgrade --install bucketreef helm/bucketreef \
  --set image.backend.repository=ghcr.io/ksperis/bucketreef-backend \
  --set image.backend.tag=0.2.1 \
  --set image.frontend.repository=ghcr.io/ksperis/bucketreef-frontend \
  --set image.frontend.tag=0.2.1
```

```bash
helm upgrade --install bucketreef helm/bucketreef \
  --set image.backend.repository=ghcr.io/ksperis/bucketreef-backend \
  --set image.backend.tag=0.2 \
  --set image.frontend.repository=ghcr.io/ksperis/bucketreef-frontend \
  --set image.frontend.tag=0.2
```

Pinned checkout/lab example with GitLab Container Registry:

```bash
helm upgrade --install bucketreef helm/bucketreef \
  --set image.backend.repository=<gitlab-registry>/<project>/backend \
  --set image.backend.tag=dev-<short-sha> \
  --set image.frontend.repository=<gitlab-registry>/<project>/frontend \
  --set image.frontend.tag=dev-<short-sha>
```

Never mix backend and frontend tags from different commits for bootstrap or
upgrade validation. CI renders the chart with the commit images and runs a
blocking Kind smoke test on image-building branches; that smoke covers bundled
PostgreSQL, pod readiness, CLI token issuance and the HTTP bootstrap contract
through the frontend proxy. Full passkey enrollment remains covered by the
browser E2E suite.

## After deploy checklist

1. Confirm backend, frontend, and scheduler pods are running.
2. Confirm secrets are injected from Kubernetes Secrets or an external secret manager.
3. Issue the bootstrap URL, create the first administrator, enroll a passkey and verify `/admin`.
4. Optionally configure the first storage endpoint.
5. Optionally create or import the first account or connection.
6. Verify the healthcheck CronJob runs and endpoint status updates when storage is configured.
7. Verify billing, quota monitoring, and usage-history CronJobs are enabled or intentionally disabled.
8. Check Browser and Portal feature flags before giving access to users.
9. Review [Operations: security](operations-security.md) and [Operations: observability](operations-observability.md) before publishing the URL broadly.

## Related pages

- [Configuration](configuration.md)
- [Production readiness](production-readiness.md)
- [Backup and restore](backup-restore.md)
- [Operations: healthchecks](operations-healthchecks.md)
- [Operations: billing](operations-billing.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)

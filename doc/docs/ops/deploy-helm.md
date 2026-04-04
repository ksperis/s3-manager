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
- Built-in CronJobs for billing, healthchecks, and quota monitoring.
- Optional bundled PostgreSQL in values (evaluate for your environment policies).

Cron values blocks:

- `billingCronJob`
- `healthcheckCronJob`
- `quotaMonitorCronJob`

Backend env defaults include billing/quota retention knobs.
Provide `SMTP_PASSWORD` via your secret injection policy.

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
- default-branch rolling release: `latest`
- stable image release: plain semver such as `0.2.0`
- Git release tag: `v0.2.0`

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
  --set image.backend.tag=0.1.5 \
  --set image.frontend.repository=ghcr.io/ksperis/s3-manager-frontend \
  --set image.frontend.tag=0.1.5
```

Lab/dev example with GitLab Container Registry:

```bash
helm upgrade --install s3-manager helm/s3-manager \
  --set image.backend.repository=<gitlab-registry>/<project>/backend \
  --set image.backend.tag=dev \
  --set image.frontend.repository=<gitlab-registry>/<project>/frontend \
  --set image.frontend.tag=dev
```

## Related pages

- [Configuration](configuration.md)
- [Operations: healthchecks](operations-healthchecks.md)
- [Operations: billing](operations-billing.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)

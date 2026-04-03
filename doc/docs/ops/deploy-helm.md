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

Tag conventions:

- shared dev and rolling lab: `dev`
- pinned lab or validation build: `dev-<short-sha>`
- default-branch rolling release: `latest`
- stable release: Git tag such as `v0.2.0`

Examples:

```bash
helm upgrade --install s3-manager helm/s3-manager \
  --set image.backend.repository=ghcr.io/ksperis/s3-manager-backend \
  --set image.backend.tag=dev \
  --set image.frontend.repository=ghcr.io/ksperis/s3-manager-frontend \
  --set image.frontend.tag=dev
```

```bash
helm upgrade --install s3-manager helm/s3-manager \
  --set image.backend.repository=ghcr.io/ksperis/s3-manager-backend \
  --set image.backend.tag=dev-a1b2c3d \
  --set image.frontend.repository=ghcr.io/ksperis/s3-manager-frontend \
  --set image.frontend.tag=dev-a1b2c3d
```

## Related pages

- [Configuration](configuration.md)
- [Operations: healthchecks](operations-healthchecks.md)
- [Operations: billing](operations-billing.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)

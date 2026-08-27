# Ops / Sysadmin Guide

This section is for operators who deploy, secure, monitor, and recover
BucketReef.

## Start here

| Situation | First page | Why |
|---|---|---|
| I am installing or taking over the service | [Sysadmin onboarding](sysadmin-onboarding.md) | A fast path through deployment, secrets, endpoint setup, jobs, backup, and handover evidence. |
| I want a secured local evaluation quickly | [Local quickstart](quickstart.md) | Starts backend/frontend only, then creates the first administrator through a one-time web link. |
| I need a lab or validation deployment | [Deploy with Docker Compose](deploy-docker-compose.md) | Manual Compose deployment, scheduler profile and production-like controls. |
| I need Kubernetes deployment details | [Deploy with Helm](deploy-helm.md) | Chart values, images, CronJobs, and multi-replica notes. |
| I need to know which knob controls behavior | [Configuration](configuration.md) | Environment variables, app settings, feature locks, and symptom-to-setting lookup. |
| I need to publish to real users | [Production readiness](production-readiness.md) | One operator checklist for secrets, database, scheduler, access, audit, and support. |
| I need to debug an incident or user report | [Observability](operations-observability.md) | Maps user symptoms to operator checks and evidence. |

## Operator workflows

| Workflow | Pages |
|---|---|
| Deploy | [Local quickstart](quickstart.md), [Docker Compose](deploy-docker-compose.md), [Helm](deploy-helm.md), [Configuration](configuration.md) |
| Secure | [Security](operations-security.md), [Production readiness](production-readiness.md), [API tokens](operations-api-tokens.md) |
| Monitor | [Healthchecks](operations-healthchecks.md), [Observability](operations-observability.md), [Billing](operations-billing.md), [Quota monitoring and history](operations-quota-monitoring.md) |
| Recover | [Backup and restore](backup-restore.md), [Upgrade and compatibility](operations-upgrade-compatibility.md) |
| Integrate backends | [Compatibility matrix](backends-compatibility.md), [Ceph RGW](backends-ceph-rgw.md), [Other S3 implementations](backends-others.md) |
| Automate | [Admin automation API](operations-admin-automation.md), [API tokens](operations-api-tokens.md) |

## First rollout checklist

1. Choose the deployment mode and image tag policy.
2. Configure non-default secrets, CORS, TLS, database persistence, and `INTERNAL_CRON_TOKEN`.
3. Configure the first endpoint and verify its healthcheck result.
4. Decide which workspaces and feature flags are ready for the first users.
5. Confirm scheduler or CronJob behavior for healthchecks, usage history, billing, and quota monitoring.
6. Confirm backup, restore, and credential encryption key ownership.
7. Run the [Storage Admin Runbook](../user/admin-runbook-storage-admin.md) before announcing the workspace.
8. Keep [User troubleshooting](../user/troubleshooting.md) and [Observability](operations-observability.md) ready for support handover.

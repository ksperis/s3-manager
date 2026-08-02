# Sysadmin Onboarding

Use this page when you install, take over, or troubleshoot an s3-manager
deployment. It is a routing page: keep it open while you jump to the detailed
runbooks.

## First 30 minutes

1. **Identify the deployment target and image tag policy.**
   Start with [Docker Compose](deploy-docker-compose.md) for a local or
   single-host stack, or [Helm](deploy-helm.md) for Kubernetes.
   Keep the image tag, chart values, Compose `.env`, and release notes.

2. **Confirm the runtime contract.**
   Use [Configuration](configuration.md) to locate the database, secrets, CORS,
   TLS, and scheduler token settings. Keep secret locations, `DATABASE_URL`,
   trusted UI origin, and `INTERNAL_CRON_TOKEN`.

3. **Configure the first storage endpoint.**
   Check the [Backends matrix](backends-compatibility.md) and
   [Ceph RGW](backends-ceph-rgw.md) notes before promising a feature. Keep the
   endpoint URL, provider type, feature flags, and healthcheck mode.

4. **Verify health, scheduler, and day-2 jobs.**
   Use [Healthchecks](operations-healthchecks.md) and
   [Observability](operations-observability.md) before inviting users. Keep the
   latest healthcheck, CronJob or scheduler status, and backend log location.

5. **Decide which product surfaces are enabled.**
   Use [Configuration](configuration.md) and
   [Production readiness](production-readiness.md) to record feature flags,
   role/group mapping, and account links for the first rollout.

6. **Protect the database, credential key, and deployment values.**
   Use [Backup and restore](backup-restore.md) and
   [Security](operations-security.md). Keep the backup schedule, restore-test
   result, and credential-key owner.

7. **Run a storage handover with the intended admin profile.**
   Follow the [Storage admin runbook](../user/admin-runbook-storage-admin.md)
   and keep the first endpoint, account/context, bucket/object validation, and
   audit evidence.

## Find the right page fast

| I need to... | Start here | Then check |
|---|---|---|
| Deploy quickly for a lab or validation environment | [Deploy with Docker Compose](deploy-docker-compose.md) | [Configuration](configuration.md), [Production readiness](production-readiness.md) |
| Deploy on Kubernetes | [Deploy with Helm](deploy-helm.md) | [Backup and restore](backup-restore.md), [Security](operations-security.md) |
| Make the deployment safe for real users | [Production readiness](production-readiness.md) | [Security](operations-security.md), [Observability](operations-observability.md) |
| Know which environment variable or setting controls a behavior | [Configuration](configuration.md) | [Feature availability](../user/feature-availability.md) |
| Debug missing menus, stale metrics, or failed jobs | [Observability](operations-observability.md) | [Healthchecks](operations-healthchecks.md), [Quota monitoring](operations-quota-monitoring.md), [Billing](operations-billing.md) |
| Restore after a host, pod, or database issue | [Backup and restore](backup-restore.md) | [Production readiness](production-readiness.md) |
| Prepare an upgrade | [Upgrade and compatibility](operations-upgrade-compatibility.md) | [Backup and restore](backup-restore.md), [Production readiness](production-readiness.md) |
| Automate admin resources | [Admin automation API](operations-admin-automation.md) | [API tokens](operations-api-tokens.md), [Security](operations-security.md) |
| Check whether a backend supports a feature | [Backends compatibility matrix](backends-compatibility.md) | [Ceph RGW](backends-ceph-rgw.md), [Other S3 implementations](backends-others.md) |

## Triage from a user report

| User report | Check first | Useful evidence |
|---|---|---|
| A workspace, menu, or action is missing | Feature flag, role, account link, Manager tool access, endpoint capability. | User email, workspace, intended account/context, screenshot. |
| `AccessDenied` appears during an S3 action | Storage-side IAM/S3 policy and selected execution identity. | Bucket/key, context selector, route, upstream error id if present. |
| Health, quota, billing, or usage data is stale | Scheduler/CronJob status, `INTERNAL_CRON_TOKEN`, latest collection logs. | Job schedule, last successful run, backend log excerpt. |
| Portal or Browser cannot open files | Browser sub-flags, Portal account link, Storage Space grants, endpoint capability. | Workspace, Storage Space or bucket, role/grant, exact action. |
| An object or bulk data operation failed | Provider S3 access logs, backend route logs, upstream S3/RGW response. | Personal executor identity, bucket/key, operation id, target prefix. |
| A purge, migration, global restore, or history cleanup failed | Application audit and backend route logs. | Actor, account/context, workflow id, target scope. |

## What an operator should keep in hand

- Deployment method, image tags, chart values or Compose `.env` ownership.
- Database location, backup schedule, and last restore-test result.
- Credential encryption key owner and recovery location.
- Secret manager paths for JWT, refresh, scheduler, SMTP, LDAP/OIDC, and storage credentials.
- Feature-flag decisions for Admin, Manager, Portal, Browser, Ceph Admin, Storage Ops, billing, endpoint status, quota, and usage history.
- First storage endpoint capability notes and healthcheck mode.
- Support handover links: [Storage admin runbook](../user/admin-runbook-storage-admin.md), [User troubleshooting](../user/troubleshooting.md), and [Observability](operations-observability.md).

## Boundaries to remember

- **Admin** governs users, endpoints, settings, audit, and platform state. It
  does not grant storage permission by itself.
- **Manager** and **Browser** execute native S3/IAM actions with the selected
  account, connection, S3 user, or Ceph Admin context.
- **Portal** uses database Storage Space metadata and grants, then projects
  storage-side policies where external access keys need enforcement.
- **Ceph Admin** is cluster-level RGW administration and should stay separate
  from tenant-scoped Manager workflows.

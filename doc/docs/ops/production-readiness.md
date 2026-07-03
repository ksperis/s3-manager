# Production Readiness

Use this checklist before exposing s3-manager to real users.

## Scope

This page turns deployment, security, observability, and user-handover pages into one operator checklist.

## Readiness checklist

| Area | Required decision | Evidence to keep |
|---|---|---|
| Version | Use a pinned stable image tag for production-like deployments. | Image tag, image digest, Git tag, release notes. |
| Secrets | JWT, refresh-cookie, credential encryption, scheduler token, SMTP, LDAP/OIDC, and storage credentials are non-default. | Secret manager paths and rotation owner. |
| Network | TLS is enforced and `CORS_ORIGINS` lists only trusted UI origins. | Ingress/reverse-proxy config. |
| Database | Persistent database storage, backup schedule, restore test, and migration procedure are documented. | Latest backup and restore-test result. |
| Scheduler | Healthcheck, billing, quota-monitor, and usage-history jobs are enabled or intentionally disabled. | Cron schedules, latest successful run, token source. |
| Endpoint | First storage endpoint has healthcheck evidence and known capability flags. | Endpoint status screenshot or log. |
| Access | Admin, Manager, Portal, Browser, Ceph Admin, and Storage Ops are enabled only for intended users. | Role/group mapping and feature flags. |
| Audit | Audit trail and backend logs are retained centrally. | Log destination and retention policy. |
| Support | User troubleshooting and admin runbook are linked from internal support docs. | Support handover note. |

## First rollout sequence

1. Deploy with Docker Compose or Helm using pinned images.
2. Configure secrets, CORS, ingress/TLS, and database persistence.
3. Configure the first endpoint and run healthchecks.
4. Create or import the first account/context.
5. Enable only the intended workspaces and feature flags.
6. Run the [Storage Admin Runbook](../user/admin-runbook-storage-admin.md).
7. Verify scheduled jobs and observability pages.
8. Communicate the user start page and support-report format.

## Before every upgrade

- Read [Operations: upgrade and compatibility](operations-upgrade-compatibility.md).
- Back up the database and confirm the backup is restorable.
- Record current feature flags and scheduler settings.
- Validate the new image in a lab or staging environment.

## Related pages

- [Deploy with Docker Compose](deploy-docker-compose.md)
- [Deploy with Helm](deploy-helm.md)
- [Configuration](configuration.md)
- [Backup and restore](backup-restore.md)
- [Operations: security](operations-security.md)
- [Operations: observability](operations-observability.md)

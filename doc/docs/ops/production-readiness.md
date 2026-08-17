# Production Readiness

Use this checklist before exposing Kaelo to real users.

## Scope

This page turns deployment, security, observability, and user-handover pages into one operator checklist.

## Publish gates

Do not publish the URL broadly until these gates are explicit:

| Gate | Minimum answer |
|---|---|
| Runtime | Which image tag, database, secret store, ingress/TLS, and trusted UI origin are used? |
| Data safety | Which database backup and credential encryption key restore path has been tested? |
| Jobs | Which healthcheck, billing, quota-monitor, and usage-history jobs are enabled or intentionally disabled? |
| Access | Which roles, UI groups, account links, and workspaces are allowed for the first users? |
| Storage backend | Which endpoint is the first supported backend and which capabilities are expected? |
| Support | Where should users report workspace, permission, upload/download, billing, or quota problems? |

## Readiness checklist

| Area | Required decision | Evidence to keep |
|---|---|---|
| Version | Use a pinned stable image tag for production-like deployments. | Image tag, image digest, Git tag, release notes. |
| Secrets | Distinct UI/API JWT rings, credential encryption, scheduler token, SMTP, LDAP/OIDC, and storage credentials are non-default. | Secret manager paths and rotation owner. |
| Authentication | Admin WebAuthn, recovery storage, session limits, scoped API tokens, and external-identity approvals are operational. | Enrollment and revocation evidence without credential values. |
| Network | TLS is enforced; origin, CORS, Host, cookie, WebAuthn, CSP, and trusted-proxy settings are exact. | Ingress/reverse-proxy config and negative startup tests. |
| Database | Persistent database storage, backup schedule, restore test, and migration procedure are documented. | Latest backup and restore-test result. |
| Scheduler | Healthcheck, billing, quota-monitor, and usage-history jobs are enabled or intentionally disabled. | Cron schedules, latest successful run, token source. |
| Endpoint | First storage endpoint has healthcheck evidence and known capability flags. | Endpoint status screenshot or log. |
| Access | Admin, Manager, Portal, Browser, Ceph Admin, and Storage Ops are enabled only for intended users. | Role/group mapping and feature flags. |
| Audit | Application control-plane audit, backend logs, and provider S3 access logs are retained centrally. | Separate destinations, activation evidence, identity attribution, and retention policies. |
| Support | User troubleshooting and admin runbook are linked from internal support docs. | Support handover note. |

## First rollout sequence

1. Deploy with Docker Compose or Helm using pinned images.
2. Set `APP_ENV=production` and configure distinct secrets, exact origin/hosts, secure cookies, WebAuthn, trusted proxies, ingress/TLS, and database persistence.
3. Configure the first endpoint and run healthchecks.
4. Create or import the first account/context.
5. Enable only the intended workspaces and feature flags.
6. Run the [Storage Admin Runbook](../user/admin-runbook-storage-admin.md).
7. Verify scheduled jobs and observability pages.
8. Communicate the user start page and support-report format.
9. Confirm that browser storage contains no token and that session/API-token revocation is immediate.

## Evidence folder

Keep these notes near the deployment runbook or ticket:

- image tag and deployment values
- secret manager paths and rotation owner
- database backup schedule and latest restore-test result
- enabled workspaces, feature flags, and initial role mapping
- scheduler/CronJob schedules and latest successful run
- first endpoint healthcheck evidence and known capability limitations
- support links: [Sysadmin onboarding](sysadmin-onboarding.md), [Storage Admin Runbook](../user/admin-runbook-storage-admin.md), and [User troubleshooting](../user/troubleshooting.md)

## Before every upgrade

- Read [Operations: upgrade and compatibility](operations-upgrade-compatibility.md).
- For migrations `0107`–`0110`, follow the mandatory [authentication cutover](authentication-hardening.md) and plan forced reauthentication/API-token recreation.
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

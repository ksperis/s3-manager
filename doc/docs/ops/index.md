# Ops / Sysadmin Guide

This section covers deployment and day-2 operations.

## Scope

- Install and deploy (`Docker Compose`, `Helm`).
- Configure features and runtime settings.
- Operate healthchecks, billing, quota monitoring, automation, and security controls.

## Recommended reading order

1. [Deploy with Docker Compose](deploy-docker-compose.md)
2. [Deploy with Helm](deploy-helm.md) when Kubernetes is the target.
3. [Configuration](configuration.md)
4. [Production readiness](production-readiness.md)
5. [Backup and restore](backup-restore.md)
6. [Security operations](operations-security.md)
7. [Operations: healthchecks](operations-healthchecks.md)
8. [Operations: quota monitoring and history](operations-quota-monitoring.md)
9. [Observability and troubleshooting](operations-observability.md)

## Day-one operator checklist

- Deploy with Docker Compose or Helm.
- Configure required secrets and trusted origins.
- Configure the first endpoint and verify healthchecks.
- Decide which workspaces and feature flags are ready for users.
- Confirm scheduler/CronJob behavior for healthchecks, usage history, billing, and quota monitoring.
- Confirm backup and restore ownership before onboarding real users.
- Keep the user-facing [Troubleshooting](../user/troubleshooting.md) page and this Ops guide aligned.

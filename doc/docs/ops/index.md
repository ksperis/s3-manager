# Ops / Sysadmin Guide

This section covers deployment and day-2 operations.

## Scope

- Install and deploy (`Docker Compose`, `Helm`).
- Configure features and runtime settings.
- Operate healthchecks, billing, quota monitoring, automation, and security controls.

## Recommended reading order

1. [Deploy with Docker Compose](deploy-docker-compose.md)
2. [Configuration](configuration.md)
3. [Security operations](operations-security.md)
4. [Operations: healthchecks](operations-healthchecks.md)
5. [Operations: quota monitoring and history](operations-quota-monitoring.md)
6. [Observability and troubleshooting](operations-observability.md)

## Day-one operator checklist

- Deploy with Docker Compose or Helm.
- Configure required secrets and trusted origins.
- Configure the first endpoint and verify healthchecks.
- Decide which workspaces, entitlements, account links, and operational feature flags are ready for users.
- Confirm scheduler/CronJob behavior for healthchecks, usage history, billing, and quota monitoring.
- Keep the user-facing [Troubleshooting](../user/troubleshooting.md) page and this Ops guide aligned.

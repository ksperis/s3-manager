# Workspace: Admin

## When to use

Use **Admin** for platform governance and global configuration.

## Prerequisites

- `ui_admin` or `ui_superadmin` role.

## Steps

1. Open `/admin`.
2. Use **Platform** to manage UI users.
3. Use **Managed Tenants** to manage RGW accounts and users.
4. Use **Connections** for S3 connections.
5. Use **Storage Backends** for endpoints and endpoint status.
6. Use **Governance** for audit trail.
7. If superadmin, use **Settings** pages for global behavior.

## Expected result

Platform and tenant-entry resources are configured and auditable.

## Limits / feature flags

!!! note
    Billing, Endpoint Status, Portal settings, and some browser settings are visible only when corresponding features are enabled.

## Related pages

- [Workspace: Manager](workspace-manager.md)
- [Ops / Configuration](../ops/configuration.md)
- [Ops / Security](../ops/operations-security.md)

## Visual example

![Admin workspace with platform-level navigation](../assets/screenshots/user/workspace-admin.png)

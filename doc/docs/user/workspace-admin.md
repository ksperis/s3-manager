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
6. Use **Usage & Metrics** to review endpoint-scoped storage, usage composition, usage history, and traffic from tabbed categories.
7. Use **Audit & Reporting** for billing, stored usage-history snapshots, and audit trail.
8. If superadmin, use **Settings** pages for global behavior, authentication options, UI-managed OIDC/LDAP providers, and key rotation.

## Expected result

Platform and tenant-entry resources are configured and auditable.

## Compact identity associations

The **Managed Tenants** RGW Accounts and RGW Users lists, together with
**Shared S3 Connections**, display linked UI users and UI groups as one compact
avatar stack. User avatars are circular; group pictograms use a rounded-square
shape so the two principal types remain distinguishable. Hover the stack, or
focus one of its links with the keyboard, to open a readable panel containing
each user email, group name, and role as compact badges. To keep very large
tooltips readable, the list is limited to 20 entries and reports how many
additional principals remain.
Click a user or group pictogram to open that principal directly in its edit
page. Emails remain searchable even though they are no longer printed in each
row.

The **UI Users** and **UI Groups** lists summarize storage associations with
three count badges: RGW accounts, RGW users, and shared S3 connections. Their
hover/focus panel exposes the complete bounded list and its roles. **UI Groups**
also shows up to five member avatars before a `+N` indicator; the same panel
still exposes up to 20 members.

In the UI user and UI group editors, association tabs first list the currently
linked resources. Use **Add…** to open a searchable picker, confirm the pending
selection with **Add selected**, and use **Remove** on an existing row to
unlink it before saving. RGW account links expose one required role selector:
**Portal user**, **Portal manager**, or **Account administrator**. The initial
picker value is **Portal user** for a Portal-compatible account and **Account
administrator** otherwise; the submitted payload is always explicit. Disabling
Portal changes capability availability, not the stored role.

Shared S3 Connections are Admin-managed, shared, and Manager-only. Their normal
forms do not expose sharing, Manager, or Browser flags. A connection migrated
without Manager access is shown as **Remediation required** and must be enabled
with the explicit remediation action. Admin routes return `404` for private
connection IDs; private connections remain owned and managed only from the
owner's profile.

The **Portal requests** requester badge uses the same avatar and role panel and
opens the requester's UI user edit page when that user still exists.

The **Created by** column of Shared S3 Connections uses the creator's user
avatar and exposes the creator identity on hover.

UI group pictograms are managed from **Platform > UI Groups > General**. A
group can use initials, one of the predefined pictograms, or a custom PNG/JPEG
image up to 1 MiB. Group images never use Gravatar or an OIDC profile image.

## Limits / feature flags

!!! note
    Billing, Endpoint Status, Portal, and some browser settings are visible only when corresponding features are enabled.

!!! note
    UI User role and entitlement rules:

    - `ui_none`: no workspace access (profile remains accessible).
    - `ui_user`: non-admin workspaces only.
    - `ui_admin`: user-level workspace access plus `/admin`.
    - `ui_superadmin`: admin access plus `/admin/*-settings`.
    - `ui_superadmin` role assignment/promotion is restricted to superadmin users.
    - `can_access_ceph_admin` can be granted only by superadmin users, and only for `ui_admin` or `ui_superadmin`.
    - `can_access_storage_ops` can be granted by `ui_admin` or `ui_superadmin` for `ui_user`, `ui_admin`, or `ui_superadmin`.
    - Manager tool access can be configured by `ui_admin` or `ui_superadmin` from the **Manager tools** tab. Each tool also requires its matching global Manager setting to be enabled.
    - Entitlements are automatically disabled when the target role does not support them.

!!! note
    Admin **Settings > Authentication** manages access-key login options and UI-defined OIDC/LDAP providers. OIDC and LDAP providers defined by backend environment variables are visible there but remain locked/read-only.

## Related pages

- [Feature: Endpoint Status in Admin](feature-endpoint-status-admin.md)
- [Feature: Billing in Admin](feature-billing-admin.md)
- [Feature: Admin Usage and Metrics](feature-admin-metrics.md)
- [Feature: Usage History in Admin](feature-usage-history-admin.md)
- [Feature: Key Rotation in Admin](feature-key-rotation-admin.md)
- [Storage admin runbook](admin-runbook-storage-admin.md)
- [Workspace: Manager](workspace-manager.md)
- [Ops / Configuration](../ops/configuration.md)
- [Ops / Security](../ops/operations-security.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-admin.light.png" alt="Admin workspace with platform-level navigation" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-admin.dark.png" alt="Admin workspace with platform-level navigation" loading="lazy">
</div>

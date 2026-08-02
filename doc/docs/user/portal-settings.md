# Portal: Settings

Use this page to review the effective configuration of the project currently
selected in the Portal. A Portal Manager can also edit the project override when
an administrator has delegated this responsibility.

## When to use

Use **Portal > Settings** to confirm the selected project, your access level,
the storage service, current Storage Space usage, and the effective Portal
capabilities and Storage Space defaults. Personal identity, display preferences,
alerts, and password settings are managed from **User profile**.

## Prerequisites

- Portal is enabled.
- You are linked to the selected project.
- The selected project is available in the Portal.

## Steps

1. Open **Portal > Settings**.
2. Confirm the selected project.
3. Review your workspace access and the associated storage service.
4. Check the number of active Storage Spaces and the storage currently used.
5. Review the effective Portal capabilities and Storage Space defaults.
6. If the page shows **Save**, choose **Inherit**, **Enable**, or **Disable** for
   each delegated override, then save. Use **Reset overrides** to return every
   project value to the administrator-defined defaults.

## Expected result

Every project member sees the effective values. Portal Users, Account
Administrators projected into Portal, non-delegated Portal Managers, and all
other read-only cases cannot change the controls. A delegated Portal Manager
can update the single shared project override also shown in Admin.

## You are done when

The project context and effective settings match the workspace you intended to
review. If you are delegated, saving or resetting an override updates the page
with the resulting effective values.

## If you do not see this action

If settings are read-only, either your project role is not Portal Manager or an
administrator has not enabled delegation for this project. Existing overrides
remain effective when delegation is disabled. Use **User profile** for personal
settings or ask an administrator to review the project configuration.

## Limits / feature flags

!!! note
    Delegation never creates a second settings layer: Admin and delegated Portal
    Managers edit the same project override. Project defaults affect newly
    created Storage Spaces only; use the Settings tab of an existing Space to
    change its Versioning, Lifecycle, or version history retention.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Storage Health](portal-usage-alerts.md)
- [Portal: Access Keys](portal-access-keys.md)
- [User profile](profile.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-settings.light.png" alt="Portal Settings page with project context and effective settings" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-settings.dark.png" alt="Portal Settings page with project context and effective settings" loading="lazy">
</div>

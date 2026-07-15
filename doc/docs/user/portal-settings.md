# Portal: Settings

Use this page to review the context of the project currently selected in the Portal.

## When to use

Use **Portal > Settings** to confirm the selected project, your access level,
the storage service, and the current Storage Space usage. Personal identity,
display preferences, alerts, and password settings are managed from
**User profile**.

## Prerequisites

- Portal is enabled.
- You are linked to the selected project.
- The selected project is available in the Portal.

## Steps

1. Open **Portal > Settings**.
2. Confirm the selected project.
3. Review your workspace access and the associated storage service.
4. Check the number of active Storage Spaces and the storage currently used.

## Expected result

The page shows the read-only context of the selected project without exposing
personal or management controls.

## You are done when

The project, access level, storage service, and usage summary match the workspace
you intended to review.

## If you do not see this action

Project configuration is not currently editable from this page. Use
**User profile** for personal settings or ask an administrator when the displayed
project context is incorrect.

## Limits / feature flags

!!! note
    Portal settings are currently read-only. They never replace Admin settings,
    Manager permissions, or storage-side IAM/S3 authorization.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Storage Health](portal-usage-alerts.md)
- [Portal: Access Keys](portal-access-keys.md)
- [User profile](profile.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-settings.light.png" alt="Portal Settings page with the selected project context" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-settings.dark.png" alt="Portal Settings page with the selected project context" loading="lazy">
</div>

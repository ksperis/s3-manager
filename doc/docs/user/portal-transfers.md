# Portal: Transfers

Use this page when you need to follow upload, download, or background transfer progress in Portal.

## When to use

Use **Portal > Transfers** after starting uploads, downloads, folder operations, or large file actions from a Storage Space.

## Prerequisites

- Portal file browsing is enabled.
- The selected Storage Space is active.
- Your role allows the transfer action you started.

## Steps

1. Start an upload, download, or file operation from a Portal Storage Space.
2. Open **Portal > Transfers**.
3. Check queued, running, completed, and failed transfer rows.
4. For failures, capture the Storage Space, object path, action, and error text.
5. Retry only after checking role, quota, endpoint status, and network conditions.

## Expected result

You can tell whether a file operation is still running, completed, failed, or waiting.

## You are done when

The transfer row reaches the expected state and the object list matches the intended result.

## If you do not see this action

Transfer visibility depends on Portal Browser access and the current user session. Use Admin audit or backend logs for platform-wide transfer investigation.

## Limits / feature flags

!!! note
    Portal transfers are scoped to self-service file work. Advanced cross-context migrations belong in Manager.

## Related pages

- [Portal: Files](portal-files.md)
- [Feature: Object operations in Browser](feature-objects-browser.md)
- [Feature: Bucket migration](feature-bucket-migration.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

This page reuses the Portal dashboard screenshot because it shows transfers in the Portal home context.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-portal.light.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-portal.dark.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
</div>

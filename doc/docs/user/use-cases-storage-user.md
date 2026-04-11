# Use Cases for Storage Users

## When to use

Use this page when your main goal is object access, limited bucket actions, or delegated tenant workflows.

## Prerequisites

- Role with user access (`ui_user` or delegated equivalent).
- At least one available execution context (account, connection, or allowed S3 user path).

## Steps

1. For object work, open **Browser**:
   - Browse buckets and prefixes.
   - Keep folders, the action bar, and the inspector visible on `/browser` when you want faster day-to-day object workflows.
   - Upload, download, preview, delete, restore versions.
2. For advanced bucket/IAM operations with delegated rights, open **Manager**.
3. If an action is unavailable, verify selected context and request additional permissions.

## Expected result

You can complete daily storage tasks without navigating admin-only areas.

## Limits / feature flags

!!! note
    Access depends on role, account links, connection permissions, and flags like `browser_root_enabled` and `manager_enabled`.

## Related pages

- [Workspace: Browser](workspace-browser.md)
- [Feature: Object operations in Browser](feature-objects-browser.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/use-cases-storage-user.light.png" alt="Browser workspace with folders, action bar, and inspector open for a daily object workflow" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/use-cases-storage-user.dark.png" alt="Browser workspace with folders, action bar, and inspector open for a daily object workflow" loading="lazy">
</div>

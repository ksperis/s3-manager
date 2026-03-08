# Workspace: Browser

## When to use

Use **Browser** for direct bucket/object operations.

## Prerequisites

- Browser feature enabled.
- At least one allowed context.

## Steps

1. Open `/browser`.
2. Select the context/account in the top selector.
3. Navigate buckets and prefixes.
4. Perform object actions: upload, download, preview, delete, restore versions, metadata/tag actions.
5. Use bucket dialogs for bucket creation or configuration if your effective permissions allow it.

## Expected result

You can perform day-to-day object operations directly from the UI.

## Limits / feature flags

!!! note
    Browser availability depends on `browser_enabled` and workspace-specific flags like `browser_root_enabled`.

## Related pages

- [Feature: Object operations in Browser](feature-objects-browser.md)
- [Troubleshooting](troubleshooting.md)

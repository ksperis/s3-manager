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
4. Perform object actions from the most appropriate surface:
   - Right-click for the full context menu on the current path, item, or selection.
   - Use the toolbar `More` menu as the non-context fallback, especially in compact layouts.
   - Use the inspector on `/browser` for the same context and selection actions without leaving the current view.
5. Perform uploads, downloads, previews, deletes, restores, and metadata/tag actions from those surfaces.
6. Use bucket dialogs for bucket creation or configuration if your effective permissions allow it.

## Notes

- `/manager/browser` and `/ceph-admin/browser` keep essential object actions available from the toolbar even without the inspector panel.
- Some actions depend on the current state. Examples: `Open` is available for a single folder selection, and deleted entries must be restored through versioning flows before direct object operations resume.

## Expected result

You can perform day-to-day object operations directly from the UI.

## Limits / feature flags

!!! note
    Browser availability depends on `browser_enabled` and workspace-specific flags like `browser_root_enabled`.

## Related pages

- [Feature: Object operations in Browser](feature-objects-browser.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

![Browser workspace with operations and search controls](../assets/screenshots/user/workspace-browser.png)

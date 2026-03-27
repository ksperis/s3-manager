# Workspace: Browser

## When to use

Use **Browser** for direct bucket/object operations.

## Prerequisites

- Browser feature enabled.
- At least one allowed context.

## Steps

1. Open `/browser`.
2. Select the context/account in the top selector.
   - If you enabled **Show tags in top selectors** from [User profile](profile.md), compact color-coded `Standard` context and endpoint tags are shown directly in the selector. `Administrative` tags remain limited to management surfaces.
3. Navigate buckets and prefixes.
   - Use the left panel to switch buckets directly from the workspace and browse folders for the active bucket.
   - The active bucket stays pinned at the top of the panel while other buckets remain collapsed.
4. Perform object actions from the most appropriate surface:
   - Right-click for the full context menu on the current path, item, or selection.
   - Use the toolbar `More` menu as the non-context fallback, especially in compact layouts.
   - Use the inspector on `/browser` for the same context and selection actions without leaving the current view.
5. Perform uploads, downloads, previews, deletes, restores, and metadata/tag actions from those surfaces.
6. Use bucket dialogs for bucket creation or configuration if your effective permissions allow it.

## Notes

- `/manager/browser` and `/ceph-admin/browser` keep essential object actions available from the toolbar even without the inspector panel.
- On `/browser`, buckets that cannot be listed are dimmed in the left panel and remain selectable so the backend error can be inspected explicitly.
- Some actions depend on the current state. Examples: `Open` is available for a single folder selection, and deleted entries must be restored through versioning flows before direct object operations resume.

## Expected result

You can perform day-to-day object operations directly from the UI.

## Limits / feature flags

!!! note
    Browser availability depends on `browser_enabled` and workspace-specific flags like `browser_root_enabled`.

## Related pages

- [Feature: Object operations in Browser](feature-objects-browser.md)
- [User profile](profile.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

![Browser workspace with operations and search controls](../assets/screenshots/user/workspace-browser.png)

# Workspace: Browser

## When to use

Use **Browser** for direct bucket/object operations.

## Prerequisites

- Browser feature enabled.
- At least one active, unexpired private S3 connection that you own and that
  has Browser access enabled.

## Steps

1. Open `/browser`.
2. Select a private connection in the top selector.
   - The selected context is recorded in `?ctx=` and remains independent in
     each open tab.
   - If you enabled **Show tags in top selectors** from [User profile](profile.md), compact color-coded `Standard` context and endpoint tags are shown directly in the selector. `Administrative` tags remain limited to management surfaces.
3. Navigate buckets and prefixes.
   - Use the workspace sidebar to search and switch buckets directly from the workspace.
   - Use the folders panel to browse folders for the active bucket.
4. Perform object actions from the most appropriate surface:
   - Right-click for the full context menu on the current path, item, or selection.
   - Use the action bar on `/browser` for the main shortcuts in this order: `Open`, `Preview`, `New folder`, `Copy`, `Paste`, `Upload`, `Download`, `Delete`, then `Refresh` and `More`.
   - Use the toolbar `More` menu as the non-context fallback, especially in compact layouts.
   - Use the inspector on `/browser` for the same context and selection actions without leaving the current view. The `Details` tab is a lightweight summary and quick-launch surface for file object details.
5. Perform uploads, downloads, previews, deletes, restores, and metadata/tag actions from those surfaces.
   - File actions such as `Preview`, `Versions`, and advanced object operations open the same `Object details` modal on the relevant tab.
   - Copy and cut selections can be pasted into another Browser context.
   - Cross-context moves remove the source only after the destination copy is verified.
6. Use bucket dialogs for bucket creation or configuration if your effective permissions allow it.
7. Open **Usage & Metrics** from the sidebar when a read-only metrics page is available. The sidebar usage gauge appears only when reliable usage data is available for the selected connection.

## Notes

- `/manager/browser` uses its own standard Browser selector and the same private
  connection policy. It is independent of the active Manager context.
- `/ceph-admin/browser` remains a separate endpoint-wide Ceph Admin surface.
- On `/browser`, buckets that cannot be listed are dimmed in the left panel and remain selectable so the backend error can be inspected explicitly.
- Accounts, assigned RGW users, shared connections, and Portal accounts are not
  standard Browser contexts. Use Portal Storage Spaces for Portal file access.
- If a remembered selection becomes invalid, Browser clears it, removes the
  `ctx` query parameter, warns you, and waits for an explicit selection.
- Some actions depend on the current state. Examples: `Open` is available for a single folder selection, and deleted entries must be restored through versioning flows before direct object operations resume.
- The last bucket and prefix are remembered only inside the current tab. A
  second tab using the same context can navigate independently.

## Expected result

You can perform day-to-day object operations directly from the UI.

## Limits / feature flags

!!! note
    Browser availability depends on `browser_enabled` and workspace-specific flags like `browser_root_enabled`.

!!! note
    If no eligible private connection exists, Browser links to **Profile >
    Private S3 connections** so you can create one with a dedicated access key.

## Related pages

- [Feature: Object operations in Browser](feature-objects-browser.md)
- [Feature: Object versions in Browser](feature-object-versions-browser.md)
- [User profile](profile.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-browser.light.png" alt="Browser workspace with operations and search controls" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-browser.dark.png" alt="Browser workspace with operations and search controls" loading="lazy">
</div>

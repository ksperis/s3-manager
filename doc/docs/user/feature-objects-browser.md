# Feature: Object Operations in Browser

## When to use

Use this guide for object-level actions in Browser surfaces.

## Prerequisites

- Access to `/browser`, `/manager/browser`, or `/ceph-admin/browser`.
- Effective permissions for target bucket/prefix.

## Before you start

Select the execution context before choosing a bucket. The same bucket name may exist in another account or connection, and object actions always use the current context credentials.

## Steps

1. Open a browser surface and choose context/account.
2. Navigate to the target bucket and prefix.
   - On `/browser`, use the left buckets panel to switch bucket directly and inspect folders for the active bucket.
   - Non-active buckets stay collapsed; inaccessible buckets are dimmed until selected.
3. Use actions as needed:
   - Use the context menu for the full action set on the current path, object, or selection.
   - Activate the icon and name to open the primary destination. A folder
     navigates, a previewable file up to 50 MiB opens on `Preview`, another file
     opens `Properties`, and a deleted object opens `Versions` or Portal
     `History`. A double-click on the same control still executes only once.
   - Select from the rest of a row or mobile card. The desktop selection bar is
     automatic; the mobile bottom bar exposes the essential actions without
     horizontal scrolling. Use `More` for every secondary action.
   - Use `More > Columns` to choose which object columns are visible. The default column set stays unchanged until you customize it.
   - Drag a column separator in the objects table header to resize `Name` and visible object columns. Double-click a separator to restore that column default width.
   - Use the inspector for context and selection information. It may open the
     full file details but does not duplicate the action toolbars.
   - Upload files
   - Download objects
   - Preview supported files
   - Delete objects or delete markers
   - Manage versions, restores, metadata, tags, ACL, retention, signed URLs, and archive restore workflows from the unified `Object details` modal for files
4. Use bulk actions when handling many objects.
5. You can copy or cut items and paste into the target bucket or prefix.
   - Same-context paste keeps the existing storage-side copy path.
   - Cross-context paste is available only in the Advanced profile. It is
     frontend-driven and transfers items one by one.
   - Cross-context move deletes the source only after the destination copy is verified.

## Action access

- Path actions include upload, folder creation, paste, versions, restore, cleanup, and copy path.
- The desktop selection bar exposes primary selection shortcuts only while a
  selection exists. Mobile uses a safe-area bottom bar and bottom sheet.
- Selection actions include download, open, copy URL, copy, cut, bulk attributes, advanced actions, restore, and delete when the current selection allows them.
- File entry points such as `Preview`, `Versions`, and advanced object actions converge into the same `Object details` modal, each opening the most relevant tab first.
- Long-running bulk actions surface in **Operations overview**, where queued, active, completed, and failed work stays visible without leaving Browser.
- `More` remains available in embedded Manager, Ceph Admin, and Portal Browser
  surfaces, where profile and resolved capability facts decide the visible set.
- On the main `/browser` page, `More > View` lets every user choose Comfortable
  or Compact density independently of the Standard, Advanced, or Portal
  functional profile. The choice is stored for the root Browser only.
- Object columns available from `More > Columns` include base listing columns such as `Size`, `Modified`, `Storage class`, and `ETag`, plus lazy detail columns such as `Content-Type`, `Tags`, `Metadata`, `Cache-Control`, `Expires`, and `Restore status`.
- Custom column widths are stored locally in the current browser and stay separate between the main `/browser` page and embedded browser surfaces.
- `Reset columns` restores both the default visible columns and the default widths.
- Only base listing columns are sortable. Lazy detail columns are display-only and load on demand for visible rows.
- Actions can be disabled for the current state. For example, `Copy URL` is disabled when SSE-C is active, and deleted items must be restored from versions before direct download or delete operations.
- Standard includes normal file operations and read-only properties. Advanced
  adds technical S3 tools, editable properties, bulk and cross-context
  operations, multipart supervision, and bucket configuration. Portal exposes
  only end-user actions authorized by the Portal-provided capabilities.

## Expected result

Object-level operations are executed with current context credentials and reflected immediately.

## You are done when

The object list, inspector, or Operations overview shows the expected completed state for the selected object or prefix.

## If you do not see this action

Check the selected object state, current surface, Browser feature flags, and IAM/S3 permissions. Some actions appear only for a file, only for a folder, or only when versioning is available.

## Limits / feature flags

!!! note
    Browser availability and operation sets depend on workspace browser flags and endpoint capabilities.

## Related pages

- [Workspace: Browser](workspace-browser.md)
- [Workspace: Manager](workspace-manager.md)
- [Feature: Object versions in Browser](feature-object-versions-browser.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/feature-objects-browser.light.png" alt="Browser operations overview showing a running delete on selected objects" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/feature-objects-browser.dark.png" alt="Browser operations overview showing a running delete on selected objects" loading="lazy">
</div>

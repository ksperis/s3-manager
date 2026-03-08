# Feature: Object Operations in Browser

## When to use

Use this guide for object-level actions in Browser surfaces.

## Prerequisites

- Access to `/browser`, `/manager/browser`, `/portal/browser`, or `/ceph-admin/browser`.
- Effective permissions for target bucket/prefix.

## Steps

1. Open a browser surface and choose context/account.
2. Navigate to the target bucket and prefix.
3. Use actions as needed:
   - Upload files
   - Download objects
   - Preview supported files
   - Delete objects or delete markers
   - Manage versions, restores, and advanced object operations
4. Use bulk actions when handling many objects.

## Expected result

Object-level operations are executed with current context credentials and reflected immediately.

## Limits / feature flags

!!! note
    Browser availability and operation sets depend on workspace browser flags and endpoint capabilities.

## Related pages

- [Workspace: Browser](workspace-browser.md)
- [Workspace: Manager](workspace-manager.md)
- [Troubleshooting](troubleshooting.md)

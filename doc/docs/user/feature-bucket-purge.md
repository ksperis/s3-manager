# Feature: Bucket purge

## When to use

Use this guide when you need to empty buckets while keeping the buckets and their
configuration.

## Prerequisites

- `bucket_purge_enabled` enabled in **Admin > Settings > Manager**.
- For Manager: access to `/manager/bucket-purge` and a UI user with
  **Manager tools > Bucket purge** access enabled.
- For Ceph Admin or Storage Ops: access to the corresponding bucket workbench.
- Effective storage permissions for deleting current objects, object versions,
  and delete markers.

## Steps

1. In Manager, open **Tools > Purge**, select the active context, and select buckets.
2. In Ceph Admin or Storage Ops, select rows in the bucket workbench and click
   **Purge selected**.
3. Review the purge summary. It lists the surface, execution context, target
   buckets, and the exact effect.
4. Set **Parallelism** if needed.
5. Type the exact confirmation phrase shown by the modal, for example
   `PURGE 2 BUCKETS`.
6. Start the purge and monitor progress until a result is displayed.

## Expected result

Selected buckets are emptied. Current objects, historical versions, and delete
markers are deleted in parallel S3 `DeleteObjects` batches. Bucket metadata and
configuration, including policies, lifecycle rules, CORS, notifications, and
versioning settings, are kept.

Deleting a bucket is a separate Manager bucket action. From **Manager >
Buckets**, empty buckets use the normal delete confirmation. Deleting a
non-empty bucket requires bucket purge access, first runs a guarded purge, and
then removes the bucket itself. That delete flow removes the bucket and its S3
configuration; this purge tool does not.

## Limits / feature flags

!!! warning
    Bucket purge is destructive. It does not delete buckets, but deleted objects,
    versions, and delete markers cannot be restored by s3-manager.

!!! warning
    The Manager bucket delete flow can remove large non-empty buckets when the
    user has bucket purge access and types the exact confirmation phrase. Empty
    bucket deletion uses the normal delete confirmation and does not require
    bucket purge access.

!!! note
    Tool visibility depends on the global `bucket_purge_enabled` flag. Manager
    access also depends on the per-user or inherited `bucket_purge` Manager tool
    right.

## Related pages

- [Workspace: Manager](workspace-manager.md)
- [Workspace: Ceph Admin](workspace-ceph-admin.md)
- [Workspace: Storage Ops](workspace-storage-ops.md)
- [Feature: Buckets](feature-buckets.md)
- [Feature: Bucket integrity check](feature-bucket-integrity-check.md)

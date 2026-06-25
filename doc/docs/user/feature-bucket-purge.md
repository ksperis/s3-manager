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
Buckets**, deleting a non-empty bucket first runs a guarded purge and then
removes the bucket itself only when no more than 10,000 deletable entries are
found. That delete flow removes the bucket and its S3 configuration; this purge
tool does not.

## Limits / feature flags

!!! warning
    Bucket purge is destructive. It does not delete buckets, but deleted objects,
    versions, and delete markers cannot be restored by s3-manager.

!!! warning
    The Manager bucket delete flow is limited to 10,000 deletable entries,
    counting current objects, historical versions, and delete markers. For
    larger buckets, use **Manager > Tools > Purge** to empty the bucket first or
    use an external S3 tool suited to large destructive operations, then delete
    the empty bucket.

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

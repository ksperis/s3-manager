# Feature: Bucket Integrity Check

## When to use

Use this diagnostic tool when you need to verify that selected buckets can be listed and that their objects can be read with the current execution identity.

## Prerequisites

- Manager: `bucket_integrity_check_enabled` set to true, plus access to **Manager > Tools > Integrity**.
- Ceph Admin: access to the selected Ceph Admin endpoint with dedicated Ceph Admin credentials configured.
- Storage Ops: access to Storage Ops and to the manager contexts that own the selected buckets.
- S3 permissions to list the bucket and read the objects being checked.

## Steps

1. Select one or more buckets from Manager, Ceph Admin, or Storage Ops.
2. Open **Check integrity**.
3. Set parallelism, optional **Since**, optional **Max MB per object**, and **All versions** if noncurrent object versions must be checked.
4. Run the check and monitor progress.
5. Review the per-bucket status, counters, bytes read, duration, and error sample.

## Expected result

The report shows whether each bucket passed, completed with object errors, or failed during listing. The tool does not write to the database and does not persist historical runs.

## Limits / feature flags

!!! note
    Manager visibility is controlled by `bucket_integrity_check_enabled`. Ceph Admin and Storage Ops access stays controlled by their own workspace permissions and feature flags.

!!! warning
    The check reads object data through `GetObject`. It can generate significant S3 traffic, latency, and backend load on large buckets.

!!! note
    By default only latest object versions are checked. **All versions** checks object versions but skips delete markers.

!!! note
    `Max MB per object` limits how many bytes are read from each object. Leave it empty for a complete read.

## Related pages

- [Workspace: Manager](workspace-manager.md)
- [Workspace: Ceph Admin](workspace-ceph-admin.md)
- [Workspace: Storage Ops](workspace-storage-ops.md)
- [Feature: Bucket compare](feature-bucket-compare.md)

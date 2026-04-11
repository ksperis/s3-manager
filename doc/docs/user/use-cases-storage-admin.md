# Use Cases for Storage Administrators

## When to use

Use this page when you are responsible for platform setup, tenant operations, or storage governance.

## Prerequisites

- Role with admin capabilities (`ui_admin` or equivalent delegated rights).
- At least one storage endpoint configured.

## Steps

1. For platform-level setup, go to **Admin**:
   - Configure endpoints.
   - Manage UI users, S3 accounts, S3 users, S3 connections.
   - Configure global feature flags and settings.
2. For tenant-level operations, go to **Manager**:
   - Manage buckets, IAM users/groups/roles/policies.
   - Use tools such as Bucket Compare and Bucket Migration when enabled.
3. For Ceph cluster-level actions, use **Ceph Admin** (if enabled):
   - RGW accounts, RGW users, buckets, endpoint metrics.
4. For cross-account and cross-connection bucket campaigns, use **Storage Ops** (if enabled):
   - Unified bucket listing and advanced filters.
   - Bulk configuration actions with preview/apply.
   - UI tags for operational grouping.
5. Use **Browser** only when object-level actions are needed.

## Expected result

You can map each operational task to the right workspace and avoid cross-scope mistakes.

## Limits / feature flags

!!! note
    Some areas are optional or restricted by endpoint capabilities: IAM support, migration tool, bucket compare, and endpoint status.

## Related pages

- [Workspace: Admin](workspace-admin.md)
- [Workspace: Manager](workspace-manager.md)
- [Workspace: Ceph Admin](workspace-ceph-admin.md)
- [Workspace: Storage Ops](workspace-storage-ops.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/use-cases-storage-admin.light.png" alt="Manager workspace navigation for storage administration" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/use-cases-storage-admin.dark.png" alt="Manager workspace navigation for storage administration" loading="lazy">
</div>

# Feature: Buckets

## When to use

Use this guide when creating, updating, or inspecting bucket configuration.

## Prerequisites

- Access to **Manager** or **Ceph Admin** bucket pages.
- **Manager tools > Feature rule inventory** access when using `/manager/feature-rules`.
- Effective storage permissions on target buckets.

## Steps

1. Open bucket list in Manager (`/manager/buckets`) or Ceph Admin (`/ceph-admin/buckets`).
2. Create or select a bucket.
3. Configure relevant settings based on endpoint support:
   - Versioning
   - Object Lock
   - Lifecycle
   - Notifications
   - CORS
   - Policy and ACL options
   - Public access controls
4. Validate changes from bucket detail views.
5. In Manager, open **Tools > Feature rules** (`/manager/feature-rules`) to
   audit lifecycle, bucket policy, CORS, notifications, or bucket tags across
   every bucket in the active context.
6. On Ceph Admin and Storage Ops bucket workbenches, use bulk update to preview
   and apply lifecycle or notification configuration changes across selected
   buckets.
7. When the purge tool is enabled, use **Manager > Tools > Purge** or
   **Purge selected** from Ceph Admin and Storage Ops bucket workbenches to empty
   selected buckets without deleting bucket configuration.
8. Use the **Usage stats** tab in bucket detail pages to review the latest
   calculated snapshot, including logical bytes by current and noncurrent object
   versions when version listing is supported.

## Expected result

Bucket configuration is applied as native backend settings and visible in detail pages.
Read-only rule inventories can be reviewed from Manager tools without editing
bucket configuration.
Usage snapshots are loaded from the database so bucket detail pages can display
the latest successful calculation quickly.

## Limits / feature flags

!!! note
    Exposed controls depend on backend capabilities. Unsupported features are hidden or disabled.
    When the endpoint supports SNS, bucket lists can add a **Notifications**
    column and bucket detail pages show whether notification configuration is
    configured or not set. Bulk notification updates still depend on the
    target context supporting bucket notifications.

## Related pages

- [Workspace: Manager](workspace-manager.md)
- [Workspace: Ceph Admin](workspace-ceph-admin.md)
- [How-to: Configure a bucket from Manager](howto-manager-bucket-configuration.md)
- [Feature: Bucket usage stats](feature-bucket-usage-stats.md)
- [Feature: Bucket purge](feature-bucket-purge.md)
- [Feature: Object operations in Browser](feature-objects-browser.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/feature-buckets.light.png" alt="Buckets feature page with creation and table controls" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/feature-buckets.dark.png" alt="Buckets feature page with creation and table controls" loading="lazy">
</div>

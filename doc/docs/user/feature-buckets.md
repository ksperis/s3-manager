# Feature: Buckets

## When to use

Use this guide when creating, updating, or inspecting bucket configuration.

## Prerequisites

- Access to **Manager** or **Ceph Admin** bucket pages.
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
5. In Manager, open **Storage > Lifecycles** (`/manager/lifecycles`) to review
   lifecycle rules across every bucket in the active context, including buckets
   with no configured rules.
6. In Manager, open **Storage > Bucket policies** (`/manager/bucket-policies`) to
   review bucket policy statements across every bucket in the active context,
   including buckets with no configured policy.
7. On Ceph Admin and Storage Ops bucket workbenches, use bulk update to preview
   and apply lifecycle or notification configuration changes across selected
   buckets.

## Expected result

Bucket configuration is applied as native backend settings and visible in detail pages.
Lifecycle rules and bucket policies can also be audited from the Manager
Storage inventories.

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
- [Feature: Object operations in Browser](feature-objects-browser.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/feature-buckets.light.png" alt="Buckets feature page with creation and table controls" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/feature-buckets.dark.png" alt="Buckets feature page with creation and table controls" loading="lazy">
</div>

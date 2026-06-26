# Workspace: Ceph Admin

## When to use

Use **Ceph Admin** for Ceph RGW cluster-level operations.

## Prerequisites

- Admin-like UI role.
- `can_access_ceph_admin` entitlement.
- At least one compatible endpoint with Ceph Admin credentials and capability.

## Steps

1. Open `/ceph-admin`.
2. Select the active endpoint in the top selector.
   - If you enabled **Show tags in top selectors** from [User profile](profile.md), compact color-coded `Standard` endpoint tags are shown directly in the selector. `Administrative` tags remain limited to management surfaces.
3. Use pages:
   - **Accounts**: RGW account operations.
   - **Users**: RGW user operations.
   - **Buckets**: cluster-level bucket inventory and configuration.
     Bucket quota and usage columns can be enabled as single-line atomic columns for easier reading and cleaner CSV exports.
   - **Usage & Metrics**: tabbed cluster-level usage composition, endpoint storage metrics, and traffic metrics.
   - **Browser**: object navigation when enabled.
4. In **Buckets**, long-running bulk actions show progress bars with completion and failure counters.
   Bulk configuration actions include lifecycle rules and bucket notification
   configurations, with preview before apply. Selected buckets can also run
   usage-stat calculations, and each bucket detail page exposes the latest
   snapshot from the **Usage stats** tab.
5. Bucket listings are cached for up to 30 minutes to reduce RGW load. Use **Refresh** in the bucket workbench to flush the cache and reload the current listing.

## Expected result

You can run Ceph cluster-wide tasks without switching to account-scoped Manager workflows.

## Limits / access

!!! note
    Workspace visibility requires the admin UI role, the Ceph Admin entitlement,
    and a compatible endpoint. Embedded Browser uses the selected Ceph Admin
    endpoint context and still depends on endpoint capability and IAM/S3
    authorization.

## Related pages

- [Use cases for storage administrators](use-cases-storage-admin.md)
- [User profile](profile.md)
- [How-to: Use Advanced Filter in Ceph Admin](howto-ceph-advanced-filter.md)
- [How-to: Use UI tags in Ceph Admin](howto-ceph-ui-tags.md)
- [Feature: Bucket usage stats](feature-bucket-usage-stats.md)
- [Ops / Ceph RGW backend notes](../ops/backends-ceph-rgw.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-ceph-admin.light.png" alt="Ceph Admin workspace with endpoint and RGW inventory" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-ceph-admin.dark.png" alt="Ceph Admin workspace with endpoint and RGW inventory" loading="lazy">
</div>

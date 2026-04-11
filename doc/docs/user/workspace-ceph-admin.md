# Workspace: Ceph Admin

## When to use

Use **Ceph Admin** for Ceph RGW cluster-level operations.

## Prerequisites

- Admin-like UI role.
- `can_access_ceph_admin` entitlement.
- `ceph_admin_enabled` feature and at least one compatible endpoint.

## Steps

1. Open `/ceph-admin`.
2. Select the active endpoint in the top selector.
   - If you enabled **Show tags in top selectors** from [User profile](profile.md), compact color-coded `Standard` endpoint tags are shown directly in the selector. `Administrative` tags remain limited to management surfaces.
3. Use pages:
   - **Accounts**: RGW account operations.
   - **Users**: RGW user operations.
   - **Buckets**: cluster-level bucket inventory and configuration.
   - **Metrics**: endpoint metrics.
   - **Browser**: object navigation when enabled.
4. In **Buckets**, long-running bulk actions show progress bars with completion and failure counters.

## Expected result

You can run Ceph cluster-wide tasks without switching to account-scoped Manager workflows.

## Limits / feature flags

!!! note
    Workspace visibility requires both user entitlement and `ceph_admin_enabled`. Browser integration also depends on `browser_ceph_admin_enabled`.

## Related pages

- [Use cases for storage administrators](use-cases-storage-admin.md)
- [User profile](profile.md)
- [How-to: Use Advanced Filter in Ceph Admin](howto-ceph-advanced-filter.md)
- [How-to: Use UI tags in Ceph Admin](howto-ceph-ui-tags.md)
- [Ops / Ceph RGW backend notes](../ops/backends-ceph-rgw.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-ceph-admin.light.png" alt="Ceph Admin workspace with endpoint and RGW inventory" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-ceph-admin.dark.png" alt="Ceph Admin workspace with endpoint and RGW inventory" loading="lazy">
</div>

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
3. Use pages:
   - **Accounts**: RGW account operations.
   - **Users**: RGW user operations.
   - **Buckets**: cluster-level bucket inventory and configuration.
   - **Metrics**: endpoint metrics.
   - **Browser**: object navigation when enabled.

## Expected result

You can run Ceph cluster-wide tasks without switching to account-scoped Manager workflows.

## Limits / feature flags

!!! note
    Workspace visibility requires both user entitlement and `ceph_admin_enabled`. Browser integration also depends on `browser_ceph_admin_enabled`.

## Related pages

- [Use cases for storage administrators](use-cases-storage-admin.md)
- [Ops / Ceph RGW backend notes](../ops/backends-ceph-rgw.md)

## Visual example

![Ceph Admin workspace with endpoint and RGW inventory](../assets/screenshots/user/workspace-ceph-admin.png)

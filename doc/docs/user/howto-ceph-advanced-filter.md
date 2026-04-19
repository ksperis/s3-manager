# How-to: Use Advanced Filter in Ceph Admin

## When to use

Use **Advanced filter** in **Ceph Admin** listings when you need precise selection by identity, quota ranges, and storage metrics:

- **Buckets** for owner identity, tags, quota limits, and quota usage percentages.
- **Accounts** for RGW account identity, quotas, counts, and account quota usage percentages.
- **Users** for RGW user identity, status, quotas, and user quota usage percentages.

## Prerequisites

- Access to `/ceph-admin/buckets`.
- An endpoint selected in Ceph Admin.

## Steps

1. Open the relevant page in **Ceph Admin**:
   - **Buckets**
   - **Accounts**
   - **Users**
2. Click **Advanced filter**.
3. In the drawer, define filter rules for the needed scope:
   - Identity fields
   - Tag criteria for buckets (S3 tags)
   - Storage and quota ranges
   - Quota usage percentage ranges for bucket, account, or user quotas when metrics are available
4. Choose match mode (`Contains` or `Exact`) per field when relevant.
5. Click **Apply filters**.
6. Review active filters and resulting bucket list; clear or refine filters as needed.

## Expected result

The current Ceph Admin listing is narrowed down to the entities matching your advanced criteria.

## Limits / feature flags

!!! note
    Some advanced filters require additional lookups or bucket metrics aggregation and can be slower on large inventories.

## Related pages

- [Workspace: Ceph Admin](workspace-ceph-admin.md)
- [How-to: Use UI tags in Ceph Admin](howto-ceph-ui-tags.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/ceph-admin-advanced-filter.light.png" alt="Ceph Admin advanced filter drawer" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/ceph-admin-advanced-filter.dark.png" alt="Ceph Admin advanced filter drawer" loading="lazy">
</div>

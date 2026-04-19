# Workspace: Storage Ops

## When to use

Use **Storage Ops** for cross-context bucket operations on S3-compatible backends, outside Ceph-only administration.

## Prerequisites

- UI role `ui_user`, `ui_admin`, or `ui_superadmin` with `can_access_storage_ops` entitlement.
- `storage_ops_enabled` feature enabled.
- At least one authorized manager context (`account` or `connection`).

## Steps

1. Open `/storage-ops`.
2. Go to **Buckets**.
3. Use the same workbench patterns as Ceph Admin Buckets:
   - quick search,
   - advanced filter,
   - dynamic columns,
   - bulk preview/apply,
   - export.
   - quota and usage columns are available as single-line atomic columns so on-screen review and CSV export stay aligned.
4. During long bulk actions (copy, preview, apply, and large exports), follow the in-page progress bars to track completion and failures.
5. Use **Context** and **Kind** columns to distinguish identical bucket names across contexts.

## Expected result

You can search and operate on large bucket sets across authorized accounts and connections from one operational surface.

## Limits / feature flags

!!! note
    In v1, Storage Ops aggregates `account` and `connection` contexts only. UI tags are local browser metadata (localStorage), namespaced separately from Ceph Admin.

## Related pages

- [Use cases for storage administrators](use-cases-storage-admin.md)
- [Workspace: Ceph Admin](workspace-ceph-admin.md)
- [How-to: Use UI tags in Storage Ops](howto-storage-ops-ui-tags.md)
- [How-to: Use Advanced Filter in Ceph Admin](howto-ceph-advanced-filter.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-storage-ops.light.png" alt="Storage Ops workspace with cross-context bucket operations" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-storage-ops.dark.png" alt="Storage Ops workspace with cross-context bucket operations" loading="lazy">
</div>

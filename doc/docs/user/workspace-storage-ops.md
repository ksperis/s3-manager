# Workspace: Storage Ops

## When to use

Use **Storage Ops** for cross-context bucket operations on S3-compatible backends, outside Ceph-only administration.

## Prerequisites

- UI role `ui_user`, `ui_admin`, or `ui_superadmin` with `can_access_storage_ops` entitlement.
- `storage_ops_enabled` feature enabled.
- At least one authorized manager context (`account`, legacy S3 user, or connection).

## Steps

1. Open `/storage-ops`.
2. Review the dashboard summary card to see how many authorized accounts,
   S3 users, and S3 connections are managed by Storage Ops, including
   shared/private connection counts and unique endpoints.
3. Go to **Buckets**.
4. Use the same workbench patterns as Ceph Admin Buckets:
   - quick search,
   - advanced filter,
   - dynamic columns,
   - click a bucket name to open its S3 API configuration,
   - select one or more rows and open **Actions…** for grouped selection and
     S3 API operations,
   - bulk preview/apply,
   - export from **Actions… > Selection > Export selection…**.
   - quota and usage columns are available as single-line atomic columns so on-screen review and CSV export stay aligned.
   - the **Notifications** column can be added to inspect bucket notification
     configuration across supported contexts.
   - the **Notification topic names** detail column can be enabled from the
     Notifications column group for cross-context topic audits.
   - other feature-detail columns can be enabled for Object Lock, block public
     access, CORS, logging, website hosting, bucket policy, and server-side
     encryption audits.
   - bucket notification configurations can be added, updated, previewed, or
     deleted in bulk from the same action flow as lifecycle rules.
   - selected buckets can run usage-stat calculations, with the latest snapshot
     available from each bucket detail page on the **Usage stats** tab.
5. In **Advanced filter**, use the compact **Context** and **Endpoint**
   selectors to pick authorized scopes directly. Their quick filters match
   names, types, and standard tags, and **Select filtered** / **Deselect
   filtered** apply to the currently filtered list.
   The shared feature-detail filters also support lifecycle rule status, such
   as locating buckets with disabled lifecycle rules, and notification rule
   details such as topic name, event, prefix/suffix filters, and EventBridge
   presence. They also support audit-oriented details such as Object Lock
   retention, logging target prefix, website documents, CORS method/origin
   pairs, policy statement counts, and server-side encryption algorithm or KMS
   key.
6. During long bulk actions (copy, preview, apply, and large exports), follow the in-page progress bars to track completion and failures.
7. Use **Context**, **Kind**, and **Endpoint** columns to distinguish identical bucket names across contexts.
8. Bucket listings are cached for up to 30 minutes per authorized context. Use **Refresh** in the bucket workbench to flush cached listings and reload the current view.

## Expected result

You can search and operate on large bucket sets across authorized accounts, S3 users, and connections from one operational surface.

## Limits / feature flags

!!! note
    UI tags are local browser metadata (localStorage), namespaced separately from Ceph Admin.
    Storage Ops exposes the Notifications feature-state filter globally; each
    bucket status still follows the SNS capability of its underlying context.
    Feature-detail columns are opt-in and loaded only when selected or exported.

## Related pages

- [Use cases for storage administrators](use-cases-storage-admin.md)
- [Workspace: Ceph Admin](workspace-ceph-admin.md)
- [Feature: Bucket usage stats](feature-bucket-usage-stats.md)
- [How-to: Use UI tags in Storage Ops](howto-storage-ops-ui-tags.md)
- [How-to: Use Advanced Filter in Ceph Admin](howto-ceph-advanced-filter.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-storage-ops.light.png" alt="Storage Ops workspace with cross-context bucket operations" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-storage-ops.dark.png" alt="Storage Ops workspace with cross-context bucket operations" loading="lazy">
</div>

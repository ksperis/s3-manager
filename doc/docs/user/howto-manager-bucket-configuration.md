# How-to: Configure a bucket from Manager

## When to use

Use this guide when you need to adjust bucket behavior from the **Manager** workspace (versioning, lifecycle, policy, CORS, quotas, and access controls).

## Prerequisites

- Access to `/manager/buckets`.
- A selected execution context (account/connection).
- Permissions to update bucket settings.

## Steps

1. Open **Manager > Buckets** (`/manager/buckets`).
2. Locate the bucket to update.
3. Click **Configure** on that bucket.
4. In the bucket detail page, update the required sections:
   - **Properties** (versioning, object lock, lifecycle, quota)
   - **Permissions** (policy, ACL, public access block)
   - **Advanced** (logging, notifications, replication, website)
5. Save changes in each section.
6. Use **Refresh** and the bucket summary to verify the expected state.

## Expected result

The target bucket reflects the new configuration and the updated status is visible in Manager.

## Limits / feature flags

!!! note
    Available controls depend on backend capabilities and account-level permissions.

## Related pages

- [Feature: Buckets](feature-buckets.md)
- [Workspace: Manager](workspace-manager.md)
- [Workspace: Ceph Admin](workspace-ceph-admin.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/manager-bucket-configuration.light.png" alt="Manager bucket list with configure action" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/manager-bucket-configuration.dark.png" alt="Manager bucket list with configure action" loading="lazy">
</div>

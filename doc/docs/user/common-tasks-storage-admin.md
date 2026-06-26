# Common Tasks for Storage Administrators

Use this page when you manage storage access, bucket configuration, or operational safety.

## Quick task map

| Task | Go to | What to check first |
|---|---|---|
| Configure endpoints and global features | [Workspace: Admin](workspace-admin.md) | You have `ui_admin` or `ui_superadmin`. |
| Check endpoint health, incidents, or latency | [Feature: Endpoint Status in Admin](feature-endpoint-status-admin.md) | Endpoint Status is enabled. |
| Create or inspect account buckets | [Workspace: Manager](workspace-manager.md) | The correct account context is selected. |
| Configure bucket features | [How-to: Configure a bucket from Manager](howto-manager-bucket-configuration.md) | The backend supports the feature. |
| Manage IAM users, groups, roles, and policies | [Feature: IAM](feature-iam.md) | IAM capability is available for the endpoint. |
| Review usage, quota, traffic, and billing | [Feature: Bucket usage stats](feature-bucket-usage-stats.md) and [Feature: Billing in Admin](feature-billing-admin.md) | Collection jobs and feature flags are enabled. |
| Compare, verify, migrate, purge, or bulk-edit buckets | [Safe destructive and bulk operations](safe-destructive-operations.md) | You have the required Manager tool access and understand the confirmation flow. |
| Work at Ceph RGW cluster scope | [Workspace: Ceph Admin](workspace-ceph-admin.md) | The Ceph Admin entitlement and endpoint are selected. |
| Run cross-context bucket campaigns | [Workspace: Storage Ops](workspace-storage-ops.md) | Storage Ops is enabled and the target contexts are authorized. |

## A good first workflow

1. Open **Admin** and confirm endpoint health.
2. Confirm that the target UI user, account link, entitlement, and operational feature settings are configured.
3. Open **Manager** and select the account context that will execute the action.
4. Create or inspect a bucket, then validate object-level access in **Browser**.
5. Review audit and usage pages before handing the workflow to end users.

## You are done when

You can explain which workspace owns the task, which identity executes the action, and which page shows the result.

## If something is unavailable

Check [feature availability](feature-availability.md) before changing permissions. A hidden action may be caused by a disabled operational feature, missing Manager tool access, endpoint capability, or storage-side denial.

## Related pages

- [Start here](start-here.md)
- [Workspace: Admin](workspace-admin.md)
- [Workspace: Manager](workspace-manager.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/use-cases-storage-admin.light.png" alt="Manager workspace navigation for storage administration" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/use-cases-storage-admin.dark.png" alt="Manager workspace navigation for storage administration" loading="lazy">
</div>

# Feature Availability

Use this page when a page, action, or menu item is missing or disabled.

## How availability is decided

s3-manager shows an action only when all required conditions are true:

1. the UI user can access the workspace from its effective role, account link, or entitlement;
2. the UI user has the right role or entitlement;
3. the selected account, connection, endpoint, or Storage Space is allowed;
4. the backend supports the feature;
5. IAM/S3 permits the actual storage action.

## Common availability checks

| Feature | Where users see it | Main controls |
|---|---|---|
| Portal | Workspace selector | Explicit `portal_user` or `portal_manager` account link. |
| Browser | Workspace selector, Manager, Portal, Ceph Admin | Allowed Browser context: account, connection, legacy S3 user, session context, Portal account context, or authorized Ceph Admin endpoint context. |
| Manager | Workspace selector | Account admin access, connection `access_manager`, legacy S3 user binding, or session account access. |
| Ceph Admin | Workspace selector | Admin UI role, `can_access_ceph_admin`, Ceph-compatible endpoint, and endpoint admin capability. |
| Storage Ops | Workspace selector | `can_access_storage_ops` and at least one authorized Manager context. |
| IAM | Manager | Endpoint IAM capability and effective Manager access. |
| SNS topics and bucket notifications | Manager, Ceph Admin, Storage Ops | Endpoint SNS capability and feature-specific action rights. |
| Bucket compare, integrity, purge, migration | Manager tools | Global Manager setting plus per-user or inherited Manager tool access. |
| Usage, quota, traffic, and billing | Admin, Manager, Portal | Collection jobs, endpoint capabilities, and operational feature settings. |

## What to do first

- Recheck the selected workspace and context.
- Open [User profile](profile.md) if you expected a private connection or selector tag.
- Ask an admin whether your UI user or group has the required entitlement.
- If the action is visible but fails, treat the error as storage-side authorization or backend capability until proven otherwise.

## You are done when

You can identify whether the missing action is caused by workspace visibility, user entitlement, account/context binding, endpoint capability, operational feature flag, or IAM/S3 authorization.

## Related pages

- [Start here](start-here.md)
- [Workspace: Admin](workspace-admin.md)
- [Workspace: Manager](workspace-manager.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/start-here.light.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/start-here.dark.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
</div>

# Feature Availability

Use this page when a page, action, or menu item is missing or disabled.

## How availability is decided

s3-manager shows an action only when all required conditions are true:

1. the workspace is enabled;
2. the UI user has the right role or entitlement;
3. the selected account, connection, endpoint, or Storage Space is allowed;
4. the backend supports the feature;
5. IAM/S3 permits the actual storage action.

## Common availability checks

| Feature | Where users see it | Main controls |
|---|---|---|
| Portal | Workspace selector | `portal_enabled` plus explicit `portal_user` or `portal_manager` account link. |
| Browser | Workspace selector, Manager, Portal, Ceph Admin | `browser_enabled` plus workspace-specific Browser flags and context access. |
| Manager | Workspace selector | `manager_enabled` plus account, connection, or legacy S3 user access. |
| Ceph Admin | Workspace selector | `ceph_admin_enabled`, Ceph-compatible endpoint, and `can_access_ceph_admin`. |
| Storage Ops | Workspace selector | `storage_ops_enabled` and `can_access_storage_ops`. |
| IAM | Manager | Endpoint IAM capability and effective Manager access. |
| SNS topics and bucket notifications | Manager, Ceph Admin, Storage Ops | Endpoint SNS capability and feature-specific action rights. |
| Bucket compare, integrity, purge, migration | Manager tools | Global Manager setting plus per-user or inherited Manager tool access. |
| Usage, quota, traffic, and billing | Admin, Manager, Portal | Collection jobs, endpoint capabilities, and feature flags. |

## What to do first

- Recheck the selected workspace and context.
- Open [User profile](profile.md) if you expected a private connection or selector tag.
- Ask an admin whether the feature is globally enabled.
- Ask an admin whether your UI user or group has the required entitlement.
- If the action is visible but fails, treat the error as storage-side authorization or backend capability until proven otherwise.

## You are done when

You can identify whether the missing action is caused by workspace visibility, user entitlement, endpoint capability, feature flag, or IAM/S3 authorization.

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

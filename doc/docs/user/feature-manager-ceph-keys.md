# Feature: Ceph Access Keys in Manager

Use this page when a storage administrator needs to create, disable, enable, or
delete Ceph RGW access keys for a managed S3 User context from Manager.

## When to use

Use **Manager > Ceph > Access keys** for a managed or imported RGW S3 user whose
keys are intentionally delegated to Manager operators.

This is different from:

- **Portal > Access keys**, which creates user-managed external keys for Portal
  users.
- **Admin > Settings > Key Rotation**, which rotates backend-managed platform
  credentials.
- **Manager IAM user key pages**, which manage IAM access keys for IAM users.

## Prerequisites

- Access to `/manager`.
- The selected Manager context is a managed S3 User context, not an RGW account
  or S3 connection.
- `manager_ceph_s3_user_keys_enabled=true` in Manager settings.
- The UI user has effective direct or group access to the selected S3 User
  context.
- The S3 User record has `allow_access_key_management=true`.
- The endpoint is a Ceph-compatible endpoint with Admin Ops credentials
  available.

## Steps

1. Open `/manager` and select the intended S3 User context.
2. Open **Ceph > Access keys**.
3. Review the current key list and search by access key id or status when
   needed.
4. Select **New key** only when the caller is ready to store the generated
   secret. The secret is shown once.
5. Select **Create my private access** to have S3-Manager create a distinct RGW
   User key and private connection without transmitting the secret to the
   browser. This separate workflow requires the UI right
   `can_provision_managed_private_connections` and the S3 User opt-in
   `allow_managed_private_connection_provisioning`; it does not use
   `allow_access_key_management`. The resulting private connection is available
   in Browser by default. Open **Advanced configuration** only when you need to
   change its Browser/Manager availability.
6. Disable a key before deleting it when you need a reversible validation step.
7. Delete unused keys only after confirming no external workflow still depends
   on them.
8. Review the audit trail for create, status-change, provisioning, cleanup, or
   delete actions.

## Expected result

The S3 User access key inventory matches the intended external-client access
state, and every mutating action is auditable from the Manager scope.

## You are done when

The intended key is present, disabled, enabled, or deleted, and a separate S3
client check confirms the expected storage behavior.

## If you do not see this action

Check the selected Manager context first. The page is available only for S3 User
contexts. Then check the global Manager setting, the effective S3 User context
assignment, the S3 User
`allow_access_key_management` flag, endpoint provider, and Ceph Admin Ops
credentials.

## Limits / feature flags

!!! warning
    This page manages RGW S3 User access keys. Treat generated secrets like
    production credentials. Do not paste them into tickets, screenshots, logs, or
    shared chat.

!!! note
    The UI-managed key marked `S3M` is locked. It cannot be disabled or deleted
    from this page.

!!! note
    A key marked **Private access** belongs to a server-managed private
    connection. It cannot be disabled or deleted from this key inventory. Open
    **Profile > Private S3 connections** and delete the linked connection so
    the server can clean up the remote key and keep durable remediation state if
    cleanup fails.

!!! note
    This feature does not grant storage permission by itself. The resulting key
    still follows RGW/S3 permissions for the underlying S3 User.

## Related pages

- [Workspace: Manager](workspace-manager.md)
- [Feature: IAM](feature-iam.md)
- [Feature: Key Rotation in Admin](feature-key-rotation-admin.md)
- [Feature availability](feature-availability.md)
- [Ops / Ceph RGW backend notes](../ops/backends-ceph-rgw.md)

## Visual example

This page reuses the Manager workspace screenshot because Ceph access keys are a
Manager context tool, and the important first step is selecting the correct
execution context.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-manager.light.png" alt="Manager workspace with buckets, topics and migration tools" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-manager.dark.png" alt="Manager workspace with buckets, topics and migration tools" loading="lazy">
</div>

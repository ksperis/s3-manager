# Identity and Execution Model

The application separates UI access from storage execution. A UI role decides
which workspace can be opened; the selected execution context decides which
credentials perform S3, IAM, or RGW operations.

## Separation of identities

| Identity | What it controls | Examples |
|---|---|---|
| UI identity | Workspace visibility, Admin settings, Manager tool access, and audit actor. | `ui_user`, `ui_admin`, `ui_superadmin`, UI groups, `can_access_storage_ops`, `can_access_ceph_admin`. |
| Execution context | Credentials and account scope used by storage actions. | RGW account, S3 connection, legacy S3 user, session context, Ceph Admin endpoint. |
| Portal grant model | User-facing Storage Space visibility and role. | Owner, Viewer, Editor, Owner collaborator grants, Portal account links. |
| Backend workflow identity | Explicit technical credential used for controlled orchestration. | Portal IAM provisioning, healthchecks, billing, quota, key rotation. |

## Context and executor

- `/manager` and `/browser` rely on execution context selection.
- `/portal` requires explicit Portal account access and uses Portal Storage
  Space metadata and grants as the source of truth.
- `/ceph-admin` uses an endpoint-scoped Ceph Admin context.
- `/storage-ops` lists and operates only over contexts the user is authorized to
  use.
- Backend services resolve the executor from the requested context and reject
  incompatible contexts instead of silently switching to another identity.

## Practical impact

A single UI user can have access to multiple accounts, connections, and
endpoints while keeping execution explicit and auditable. Granting a menu item
or Manager tool access does not grant native storage permission by itself; S3,
IAM, RGW Admin Ops, or Portal grants still decide whether the storage action is
allowed.

## Quick troubleshooting matrix

| Symptom | Check first |
|---|---|
| Workspace is missing | Global feature flag, UI role, user or group entitlement. |
| Context is missing | Account link, S3 connection access flag, private connection assignment, or endpoint availability. |
| Menu item is hidden in Manager | Global Manager tool setting, user or group Manager tool access, endpoint capability, and selected context type. |
| Portal Storage Space is missing | Portal account link, Storage Space metadata, access mode, collaborator grant, and archived state. |
| Action is visible but returns `AccessDenied` | Storage-side IAM/S3/RGW permission and the selected execution identity. |

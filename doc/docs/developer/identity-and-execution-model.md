# Identity and Execution Model

The application separates UI access from storage execution. A UI role decides
which workspace can be opened; the selected execution context decides which
credentials perform S3, IAM, or RGW operations.

## Separation of identities

| Identity | What it controls | Examples |
|---|---|---|
| UI identity | Workspace visibility, Admin settings, Manager tool access, and audit actor. | `ui_user`, `ui_admin`, `ui_superadmin`, UI groups, `can_access_storage_ops`, `can_access_ceph_admin`. |
| Execution context | Credentials and account scope used by storage actions. | RGW account, S3 connection, legacy S3 user, session context, Ceph Admin endpoint. |
| Portal grant model | User-facing Storage Space visibility and role. | Private Owner, team Viewer/Editor grants, project Manager, Portal account links. |
| Backend workflow identity | Explicit technical credential used for controlled orchestration. | Portal IAM provisioning, healthchecks, billing, quota, key rotation. |

## Context and executor

- `/manager` and `/browser` rely on execution context selection.
- `/portal` requires explicit Portal account access and uses Portal Storage
  Space metadata and grants as the source of truth.
- One RGW account represents one Portal project. The account-local
  `portal-manager` IAM group can therefore grant the fixed Manager data-plane
  action set once for all project Storage Spaces; technical buckets apply an
  explicit principal-scoped resource-policy `Deny`.
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

## Multi-tab context contract

- The visible query parameter is the authority for each tab: `ctx` for Manager
  and Browser, `project` for Portal, and `ep` for Ceph Admin.
- Manager and Browser keep distinct default-context preferences. A preference
  may initialize a new tab, but it never replaces a valid URL or the context
  already mounted in another tab.
- Portal follows the same rule for project selection. Internal navigation that
  omits `project` keeps the current tab's project and restores it in the URL.
- Browser bucket and prefix position, Bucket Ops row selections, and the Bucket
  Ops configuration clipboard are operational tab state. They are not shared
  through `localStorage`; bucket/prefix position and the clipboard use
  `sessionStorage`, while row selections start empty after a remount.
- Access-token refresh is serialized across tabs. After one tab rotates the
  refresh cookie, waiting tabs reuse the newly stored access token instead of
  attempting a second rotation.

These rules intentionally do not migrate former shared selector, selection, or
Browser-position snapshots. Old values are ignored rather than kept through a
compatibility layer.

## Quick troubleshooting matrix

| Symptom | Check first |
|---|---|
| Workspace is missing | Global feature flag, UI role, user or group entitlement. |
| Context is missing | Account link, S3 connection access flag, private connection assignment, or endpoint availability. |
| Menu item is hidden in Manager | Global Manager tool setting, user or group Manager tool access, endpoint capability, and selected context type. |
| Portal Storage Space is missing | Portal account link, Storage Space metadata, access mode, collaborator grant, and archived state. |
| Action is visible but returns `AccessDenied` | Storage-side IAM/S3/RGW permission and the selected execution identity. |

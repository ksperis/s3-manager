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

## Canonical account access

Account associations carry one canonical, ordered role:

1. `portal_user`
2. `portal_manager`
3. `account_administrator`

Direct and UI-group associations are combined by taking the highest role. The
effective-access response includes the direct source, every contributing group,
and the source or sources that determine the maximum. `UserS3Account.is_root`
is internal and protected; it always projects `account_administrator`.

The legacy `account_admin` and `account_role` request fields are accepted only
at the API boundary for this compatibility release. They are converted to
`role`, contradictory canonical/legacy payloads are rejected with `422`, and
services never read the legacy fields. Deprecated response fields are derived
from the canonical role. The legacy database columns no longer exist.

An association without a useful legacy right is deleted by migration `0069`.
It is not represented as `role = NULL` and cannot be recovered by downgrade;
only the verified pre-upgrade database backup can restore it.

## Workspace authorization matrix

`EffectiveAccessService` is the authority for catalogue construction and
execution of a selected context.

| Workspace | Allowed UI-user contexts |
|---|---|
| Manager | `account_administrator` accounts, assigned RGW users, assigned shared Manager connections, and the owner's active private Manager connections. |
| Browser | Only the owner's active, unexpired, non-temporary private connections with `access_browser = true`. |
| Portal | Compatible account membership projected to `portal_user` or `portal_manager`; account administrators project to Portal manager. Execution always uses the user's personal Portal IAM identity. |
| Ceph Admin Browser | The explicit endpoint-wide Ceph Admin branch. |
| Direct S3 session | The explicit session principal and its session capabilities. |

Accounts, RGW users, shared connections, and Portal contexts are rejected by
standard Browser before credential resolution, including forged context IDs.
The embedded Manager Browser uses the same independent private-connection
policy; it does not reuse the active Manager identity.

`GET /api/me/workspace-access` returns availability, context counts, and the
backend-selected default workspace. Password login, LDAP, OIDC, redirects, and
the workspace selector consume this contract instead of reconstructing access
from a cached user profile.

## Practical impact

A single UI user can have access to multiple accounts, connections, and
endpoints while keeping execution explicit and auditable. Granting a menu item
or Manager tool access does not grant native storage permission by itself; S3,
IAM, RGW Admin Ops, or Portal grants still decide whether the storage action is
allowed.

## Multi-tab context contract

- The visible query parameter is the authority for each tab: `ctx` for Manager
  and Browser, `project` for Portal, and `ep` for Ceph Admin.
- Manager and Browser keep distinct default-context preferences. If a Browser
  preference or `ctx` value is no longer authorized, the client removes both,
  shows a warning, and requires an explicit selection. It never falls back to
  the first available context.
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

## Server-managed private access

Manager exposes two specialized provisioning branches that never return the
new secret to the frontend:

- an authorized, IAM-capable RGW Account or S3 Connection creates a dedicated
  deterministic IAM user, applies validated groups and policies, creates the
  access key last, then stores it in an owned private S3 Connection;
- an assigned RGW User with Ceph key-management permission creates a distinct
  RGW key and immediately stores it in an owned private S3 Connection.

The identity is independent of `AccountIAMUser` and every Portal identity. A
shared connection is only an administration context; its credentials,
associations, capabilities, and tags are never copied. Endpoint data is derived
server-side from the selected Manager context.

`managed_private_accesses` records the UI owner, immutable source context,
remote principal, access key ID, private connection, applied IAM resources, and
saga state. It deliberately contains no secret. A partial unique index permits
only one `provisioning`, `active`, `deleting`, or `cleanup_pending` row per UI
user and source context. Remote mutations are checkpointed, compensated in
reverse order on failure, and retained as `cleanup_pending` when compensation
cannot finish.

Connections created through this flow have `server_managed = true`. Generic
connection APIs may change only their name, tags, active state, and workspace
flags. Endpoint, credentials, principal, provenance, rotation, and deletion are
owned by the orchestrator. IAM/RGW key inventories expose the managed link and
reject direct status or delete operations.

## Quick troubleshooting matrix

| Symptom | Check first |
|---|---|
| Workspace is missing | Global feature flag, UI role, user or group entitlement. |
| Context is missing | Canonical account role, assigned RGW user/shared Manager connection, owned private connection flags/activity/expiry, or endpoint availability. |
| Menu item is hidden in Manager | Global Manager tool setting, user or group Manager tool access, endpoint capability, and selected context type. |
| Portal Storage Space is missing | Portal account link, Storage Space metadata, access mode, collaborator grant, and archived state. |
| Action is visible but returns `AccessDenied` | Storage-side IAM/S3/RGW permission and the selected execution identity. |

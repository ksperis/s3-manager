# Identity and Execution Model

The application separates UI access from storage execution. A UI role decides
which workspace can be opened; the selected execution context decides which
credentials perform S3, IAM, or RGW operations.

## Separation of identities

| Identity | What it controls | Examples |
|---|---|---|
| UI identity | Workspace visibility, Admin settings, Manager tool access, and audit actor. | `ui_none`, `ui_user`, `ui_admin`, `ui_superadmin`, UI groups, `can_access_storage_ops`, `can_access_ceph_admin`. |
| Execution context | Credentials and account scope used by storage actions. | RGW account, S3 connection, legacy S3 user, session context, Ceph Admin endpoint. |
| Portal grant model | User-facing Storage Space visibility and role. | Private Owner, team Viewer/Editor grants, project Manager, Portal account links. |
| Backend workflow identity | Explicit technical credential used for controlled orchestration. | Portal IAM provisioning, healthchecks, billing, quota, key rotation. |

## Personal storage identity contract

- Every human operator uses a dedicated IAM identity or owned private S3
  connection; credentials are never shared between people.
- One personal identity may temporarily have multiple keys during rotation.
  Every key must still identify that same person and be retired after rotation.
- Portal already executes S3 operations with the signed-in user's personal IAM
  identity. Portal external access is assigned to one named person and must
  preserve that attribution.
- Application audit identifies control-plane actors. Object-level attribution
  comes from provider S3 access logs. Without provider logging and retention,
  the application cannot reconstruct an exhaustive object audit trail.

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

## Canonical UI roles

`users.role` stores exactly one role: `ui_none`, `ui_user`, `ui_admin`, or
`ui_superadmin`. The database constraint, backend request models, automation
models, and frontend API types share this contract. Historical aliases are
migrated by revision `0092`; they are not accepted or normalized at runtime.

`ui_none` is the explicit no-workspace role. Unknown historical values migrate
to `ui_none` so canonicalization cannot grant access accidentally.

## Canonical account access

Account associations carry one canonical, ordered role:

1. `portal_user`
2. `portal_manager`
3. `account_administrator`

Direct and UI-group associations are combined by taking the highest role. The
effective-access response includes the direct source, every contributing group,
and the source or sources that determine the maximum. `UserS3Account.is_root`
is internal and protected; it always projects `account_administrator`.

Account-association API payloads expose and accept only `role`. Unknown or
removed association fields are rejected with `422`, and the legacy database
columns no longer exist.

An association without a useful legacy right is deleted by migration `0069`.
It is not represented as `role = NULL` and cannot be recovered by downgrade;
only the verified pre-upgrade database backup can restore it.

## Workspace authorization matrix

`EffectiveAccessService` is the authority for catalogue construction and
execution of a selected context.

| Workspace | Allowed UI-user contexts |
|---|---|
| Manager | `account_administrator` accounts, assigned RGW users, assigned shared Manager connections, and the owner's active private Manager connections. |
| Browser | The owner's active, unexpired, non-temporary private connections with `access_browser = true`, plus compatible Portal projects whose effective `portal.browser_access_enabled` setting is true. Portal project execution uses the personal Portal IAM identity and Portal profile. |
| Portal | Compatible account membership projected to `portal_user` or `portal_manager`; account administrators project to Portal manager. Execution always uses the user's personal Portal IAM identity. |
| Ceph Admin Browser | The explicit endpoint-wide Ceph Admin branch. |
| Direct S3 session | The explicit session principal and its session capabilities. |

Generic account contexts, RGW users, and shared connections are rejected by
standard Browser before credential resolution. An enabled Portal project is
published as the distinct `portal_account` context and resolved through the
Portal authorization branch, never through account administrator credentials.
The embedded Manager Browser keeps its independent private-connection policy;
it does not reuse the active Manager identity.

`GET /api/me/workspace-access` returns availability, context counts, and the
backend-selected default workspace. Password login, LDAP, OIDC, redirects, and
the workspace selector consume this contract instead of reconstructing access
from a cached user profile.

## Practical impact

A single UI user can have access to multiple accounts, connections, and
endpoints while keeping execution explicit and attributable. Granting a menu item
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

S3 Connection identity metadata uses only `iam_user`, `account_user`, or
`s3_user` as `credential_owner_type`. The durable provisioning saga may retain
the storage-side principal kind `rgw_user`, but the resulting connection always
uses the canonical `s3_user` API and database value. Migration `0073` converts
existing rows and removes the frontend fallback for unknown owner types.

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

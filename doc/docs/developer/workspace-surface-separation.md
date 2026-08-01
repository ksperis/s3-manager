# Workspace Surface Separation

## Purpose

The product exposes distinct workspaces for distinct jobs. A feature should be
placed in the narrowest surface that matches the user's intent and the required
execution identity.

## Surfaces

- `/portal` is the end-user Storage Workspace. It is centered on storage spaces,
  simple file operations, shares, activity, transfers, usage, alerts, requests
  to storage admins, and user preferences.
- `/browser` is the advanced object explorer. It owns bucket/object diagnostics,
  versions, metadata, tags, batch operations, advanced object actions, and
  technical S3 inspection workflows.
- `/manager` is the S3 and account configuration workspace. It owns native S3
  and identity configuration, bucket properties, policies, users, groups, roles,
  lifecycle, replication, notifications, and topics.
- `/admin` is the platform administration workspace. It owns UI users,
  endpoints, accounts, global quotas, billing administration, feature flags,
  audit, health, Portal request validation, and governance.

## Browser Disablement Matrix

The Browser is shared across several surfaces, but feature disablement must not
be treated as a replacement permission model. Native Browser contexts stay
aligned with storage-side S3/IAM authorization. Portal Browser contexts first
resolve visible Storage Spaces and roles from Portal database metadata and
grants; IAM is only the synchronized projection for personal S3 keys and
external storage enforcement. Browser gates should be used to reduce workflow
exposure, prevent confusing execution identities, or keep a workspace focused
on its job.

### Current Workspace Profiles

| Browser surface or profile | Execution identity | Current gate | Already disabled or restricted today | Decision notes |
| --- | --- | --- | --- | --- |
| `/browser` standalone | An active, unexpired private S3 connection owned by the current user with `access_browser = true`. | `browser_enabled`, `browser_root_enabled`, ownership, private visibility, activity, expiry, and the Browser flag. User or group `browser_advanced_features_enabled` controls advanced chrome. | Accounts, RGW users, shared connections, Portal contexts, and forged IDs are rejected before credential resolution. An invalid remembered context is cleared without fallback. | The standard Browser requires a dedicated personal access key. Portal file work stays in Portal Storage Spaces. |
| `/manager/browser` embedded Browser | Its own standard Browser private-connection selection, independent of the active Manager context. | `browser_enabled`, `browser_manager_enabled`, plus the same ownership/activity/expiry/Browser policy as `/browser`. | Disabled by default. Even when enabled, it uses embedded compact chrome and never reuses Account, RGW-user, or shared Manager credentials. | Object browsing can remain visually embedded without widening the Manager execution identity. |
| `/portal/storage-spaces/:spaceId` locked Browser | Portal execution identity resolved for the selected account and DB-backed Storage Space. | `browser_enabled`, `browser_portal_enabled`, `portal_enabled`, Portal account role, `X-S3-Workspace: portal`, active Storage Space visibility, DB grant role, and the `portal-basic` profile. | Enabled by default but locked to one active Storage Space. Bucket switching and bucket search are hidden and backend bucket lists are filtered to active Storage Spaces with Portal metadata and content access. Backend allows only the basic Portal route subset: settings, bucket search, object list/download/CORS, read-only versioning/version listing, presign/delete/folders/proxy upload, and multipart upload lifecycle calls. UI action allowlist keeps upload files, upload folder, new folder, copy path, details, download, delete, opening a single folder, and an optional mixed deleted-file view. Viewer Storage Spaces hide upload, folder creation, delete, and restore actions. The details action routes to the Portal object detail page, not the advanced Browser modal. | This is the current minimal end-user file profile. Archived Storage Spaces must be blocked even if older Portal credentials still have storage-side access. Portal managers have full content access to every project Storage Space. Backend Portal checks use DB metadata and grants; IAM policies are projection/enforcement for S3 keys, not the source for listings or roles. |
| `/ceph-admin/browser` embedded Browser | Endpoint-wide Ceph Admin credentials for the selected Ceph endpoint. | `browser_enabled`, `browser_ceph_admin_enabled`, `ceph_admin_enabled`, admin UI role, endpoint admin access, Ceph provider check, and an explicit risk acknowledgement dialog. | Disabled by default. It uses embedded compact chrome and requires endpoint admin access. The UI warns that operations may execute with an owner identity different from the tenant owner. | Keep disabled for regular object work. Prefer S3 Connections with the expected owner when tenant ownership matters. |

### Feature Families To Evaluate

| Browser capability family | Why it may be useful to disable by workspace or user | Current implementation and gates | Already disabled today | Possible future decision point |
| --- | --- | --- | --- | --- |
| Workspace availability | Some deployments need Browser only in Portal or only for operators. | Global `browser_enabled` plus per-surface flags: `browser_root_enabled`, `browser_manager_enabled`, `browser_portal_enabled`, `browser_ceph_admin_enabled`. | Manager and Ceph Admin Browser are disabled by default; root Browser and Portal Browser are enabled by default. | Decide whether defaults should differ by deployment profile, for example end-user-only, operator-only, or lab/demo. |
| Advanced Browser chrome | Panels, layout persistence, action bar, column controls, and bucket shortcuts can make a simple file workflow look like an operator console. | Root route checks effective `browser_advanced_features_enabled` from the user or any UI group. Embedded Browser sets `allowFoldersPanel`, `allowInspectorPanel`, and `showPanelToggles` to false. | Disabled for embedded Manager, Portal, and Ceph Admin Browser. Disabled on `/browser` for users/groups without advanced Browser access. | Add more granular admin toggles only if compact/full is too coarse. |
| Bucket switching and bucket creation | Bucket selection and creation expose storage topology and can blur Portal Storage Space boundaries. | Portal passes `lockedBucketName`; bucket creation requires full root Browser, non-embedded path, non-Portal profile, and advanced root access. | Portal cannot switch buckets. Embedded surfaces and non-advanced root users do not get the Browser bucket creation shortcut. | Consider a separate bucket-management toggle if root Browser should browse existing buckets but never create new ones. |
| Search options and object-list refinements | Recursive, exact, case-sensitive, type, and storage-class search can be noisy or expensive for simple workspaces. | Advanced search menu is hidden by the `portal-basic` profile. Full profiles expose it from the object search field. | Disabled in Portal Browser. | Consider per-user or per-workspace limits for recursive search on large buckets or cost-sensitive endpoints. |
| Basic file mutations | Upload, folder creation, delete, and paste are expected for editors but not for read-only users. | Portal basic keeps upload, new folder, download, delete, and single-folder open available for Editor and Owner spaces; Viewer spaces hide upload files, upload folder, new folder, and delete. Storage-side credentials still decide whether any operation succeeds. Full profiles expose broader file mutations when context and state allow them. | Paste/copy/cut are disabled in Portal. Upload and delete are hidden for Viewer spaces. | Add similar role-aware UI hiding for read-only non-Portal connections only if a reliable role signal exists. |
| Preview, properties, raw metadata, tags, and advanced object details | Metadata, tags, storage class, headers, ACL-like details, legal hold, retention, and restore controls are operational details that may be inappropriate in end-user spaces. | Full profiles open the shared object details modal from Preview, Properties, Versions, or Advanced actions. Portal basic removes those actions. | Disabled in Portal Browser. Inspector panel is disabled in embedded Browser and for non-advanced root users. | Split read-only preview from mutating metadata controls if some users need safe preview but not technical object editing. |
| Presigned URL and path sharing helpers | Copying presigned URLs can increase data exfiltration risk or bypass preferred sharing workflows. | `Copy URL` is a full-profile action and is also disabled when SSE-C mode is active because required encryption headers are missing. | Disabled in Portal Browser. Disabled in SSE-C mode. | Add an explicit per-user/per-workspace presign toggle when public-link or sharing policy must be centralized. |
| Copy, cut, paste, and cross-context moves | Cross-context movement can cross tenant, account, or ownership boundaries. | Full profiles expose copy/cut/paste when selection, clipboard, and context allow it. Cross-context moves copy first and remove the source only after destination copy verification. | Disabled in Portal Browser. | Consider disabling cross-context paste separately from same-context copy if tenant isolation policy requires it. |
| Versioning, deleted-object, restore, and cleanup tools | Version listing, restore-to-date, deleted-object display, and cleanup are powerful and potentially destructive. | Actions are visible only when bucket versioning is enabled or suspended. Portal allows read-only version status/listing for the mixed file view, plus Portal-owned single-file and folder-prefix restore flows. Advanced Browser version actions and cleanup routes remain excluded from `portal-basic`. | Portal shows deleted files only on explicit request and only in the current folder. Deleted rows cannot enter normal file selections. Viewer spaces cannot restore. Cleanup and technical version tools remain disabled in Portal Browser. | Keep listing on demand with S3 cursors; do not add a global trash index, periodic refresh, or implicit root-space restore. |
| Bulk operations | Bulk delete, bulk attributes, and bulk restore amplify mistakes and can create large backend workloads. | Full profiles expose bulk attributes and restore-to-date when selection state allows it. Portal basic keeps delete but removes bulk attributes and restore. | Bulk attributes and bulk restore are disabled in Portal Browser. | Add batch-size, dry-run, or role gates for large selections, especially on shared connections. |
| Multipart upload supervision | Listing and aborting orphaned multipart uploads is operational maintenance, not a normal file-user task. | Full Browser can list multipart uploads and abort individual uploads. Portal backend allows active multipart upload lifecycle calls needed for uploads but not the multipart listing route. | Multipart upload listing is unavailable in Portal Browser. | Keep supervision in operator profiles unless Portal needs user-visible recovery for their own failed uploads. |
| SSE-C controls | Customer-provided encryption keys create handling and support risks. | SSE-C controls require endpoint capability and are disabled for the Portal basic profile. | Disabled in Portal Browser and unavailable when endpoint capabilities do not advertise SSE support. | Consider restricting SSE-C to advanced users only, or disabling it per endpoint when support teams cannot recover from user-managed keys. |
| Proxy transfers and transfer concurrency | Backend proxy mode and high parallelism affect backend load and security posture. | Browser settings expose global proxy mode, ZIP streaming threshold, and upload/download/operation parallelism. These are not per-user or per-workspace today. | Not disabled per workspace or user today. | Decide whether high-throughput or proxy features need stricter defaults for Portal, shared connections, or constrained deployments. |

Portal Browser operations that pass through backend routes with the resolved
Portal context are audited with `scope = portal` and a Storage Space metadata
reference. The Portal UI also records local transfer progress for uploads and
downloads it can observe. Presigned downloads opened directly by the browser are
not marked completed locally because the web app cannot observe the final file
save.

Portal identities never appear in root `/browser`. Portal object operations run
only from the Portal Storage Space surfaces with the personal IAM identity.
Internal bucket names remain execution identifiers and must not appear in
Portal-facing labels.

## Portal Rules

- Keep Portal labels user-oriented: `Storage Spaces`, `Shares`, `History`,
  `Storage health`, `Help requests`, and `Settings`. `History` separates
  activity, transfers, and manager-only access logs into explicit tabs.
- Do not add a `/portal/browser` route. Portal may embed the main Browser on
  `/portal/storage-spaces/:spaceId`, in a locked Storage Space context with the
  `portal-basic` action profile and `X-S3-Workspace: portal`. Portal accounts
  must never be added to the standard Browser catalogue.
- Do not use Portal as a shortcut to Manager configuration.
- Do not expose policy documents, principals, ARNs, advanced ACLs, object
  diagnostics, bucket defaults, lifecycle, CORS, replication, or versioning in
  Portal UI text.
- Do not reintroduce a Storage Space `Type` field. Use `visibility` for
  `private` or `shared`, `share_scope` for restricted versus all-account
  sharing, and `archived_at`/`status` for archived state.
- Private Storage Space creation is exposed through the dedicated
  `can_create_private_storage_spaces` Portal state flag. Team creation uses
  `can_create_team_storage_spaces`. Do not reuse
  `can_manage_buckets` for portal-user creation UI, because bucket management
  remains a broader portal-manager/operator capability.
  Both Portal roles need the private-creation setting to create a private
  space. Only a `portal_manager` can create or import a team space; named
  bucket mode still requires the named bucket creation setting.
- Private Storage Spaces are visible only to their owner and Portal managers.
  Portal managers have full UI and content access and can explicitly take
  ownership. Visibility is immutable after creation. Team Storage Spaces have
  no owner and either use DB-backed Viewer and Editor grants
  from `portal_storage_space_grants`, or `share_scope = account` to grant the
  configured default role to current and future effective Portal members of the
  account. Portal must not silently create account membership when adding an
  individual share; users outside the account require a separate admin workflow.
  Archived Storage Spaces suspend Portal access and public links without
  deleting stored grants or links.
- Portal user usage views may show global account usage and quota pressure, but
  named Storage Space breakdowns, activity, and transfer rows must be scoped to
  content-accessible Storage Spaces. Any hidden remainder must be represented
  only as an anonymous `Other` aggregate with no bucket or Storage Space
  identifiers.
- Portal-managed bucket policies must only add, replace, or remove dedicated
  `Sid` statements such as `PortalStorageSpaceAccess` and
  `PortalStorageSpaceArchived`. They must preserve unrelated bucket policy
  statements. The Portal role templates for `Viewer`, `Editor`, `Owner`, and `Manager`
  are code-owned backend projections from DB grants; they are not an editable
  bucket/IAM policy document in Portal.
- Because one RGW account maps to one Portal project, the code-owned
  `portal-manager` IAM group carries both the minimal global bootstrap actions
  (`s3:ListAllMyBuckets`, `sts:GetSessionToken`) and the explicit Manager
  data-plane action set on that account's bucket and object ARNs. Do not
  reintroduce `iam:*`, `s3:*`, `s3:CreateBucket`, or mutating
  bucket-configuration actions. Technical buckets must override this group
  access with a resource-policy `Deny` for manager IAM user principals.
- Keep Portal authorization backed by Portal database metadata and grants.
  Storage IAM policies are synchronized projections for personal S3 keys and
  external enforcement; they must not be read back as the Portal source of
  listings or roles.
- Keep Portal requests on `/portal/requests` as an end-user submission and
  follow-up surface. Portal users can request project membership for another
  person, remove a Portal user, or request a target quota change, but the
  approval workflow and execution stay in Admin on `/admin/portal-requests`.

## Routing Contract

Portal canonical routes are:

- `/portal`
- `/portal/storage-spaces`
- `/portal/storage-spaces/:spaceId`
- `/portal/storage-spaces/:spaceId/objects/*`
- `/portal/access-keys`
- `/portal/shares`
- `/portal/history`
- `/portal/usage`
- `/portal/requests`
- `/portal/settings`

`/portal/activity` and `/portal/transfers` remain compatibility redirects to
the corresponding `/portal/history` tab. They are not canonical navigation
destinations.

Portal administration mock pages such as `/portal/users`, `/portal/groups`,
and `/portal/policies` are intentionally not routed in the production Portal
surface. They can return later only as real user-facing Portal features or
isolated demo/test fixtures. `/portal/access-keys` is a real user-facing Portal
feature for the current user's personal keys and Storage Space-scoped external
credentials. It must never expose the active Portal runtime key.
The Admin counterpart for storage-admin triage is `/admin/portal-requests`.

## Portal Backend Cleanup Notes

Portal uses Storage Space, file, share, activity, transfer, usage, alert,
billing-source, health, request, and simple settings endpoints only. Legacy
backend routes that exposed bucket-centric or advanced identity concepts have
been removed from the Portal router and API client:

- `/portal/buckets*`;
- `/portal/bootstrap`;
- `/portal/users*` bucket-grant and Portal user-management routes;
- `/portal/account-settings`;
- `/portal/iam-compliance*`.
- `/portal/settings` advanced Portal settings payloads.

Use `/portal/storage-spaces*` and `/portal/storage-spaces/{spaceId}/shares*`
for end-user collaboration workflows. Use `/admin/accounts/{accountId}/portal-settings`
for super-admin-only Portal override governance. Portal managers cannot manage
or apply account Portal overrides. Native IAM, policy compliance, access-key, and
bucket administration workflows belong outside the Portal user surface. Personal
Portal preferences belong to `/portal/profile` and use the simple `/users/me`
`ui_preferences` contract, not the advanced Portal settings payload. The
`/portal/settings` page remains project-scoped. Stored preferences such as theme
and default Portal account are UI defaults only; they never grant account access.

### Breaking API Notes

Portal clients must not call the removed legacy endpoints listed above.
Use these replacement surfaces instead:

- Storage Space list/detail/create/update: `/portal/storage-spaces*`.
- Simple object list/detail/upload/download/delete/folders:
  `/portal/storage-spaces/{spaceId}` for the locked Browser file profile and
  `/portal/storage-spaces/{spaceId}/objects*` for object detail routes.
- Collaboration: `/portal/storage-spaces/{spaceId}/shares*`.
- Public links: `/portal/storage-spaces/{spaceId}/public-links*`.
- Usage, activity, transfers, alerts, traffic, health, and billing source:
  the remaining Portal read endpoints.
- External S3 credentials:
  `/portal/access-keys`, excluding the active Portal runtime key. Personal keys
  follow the user's Portal grants; external credentials are dedicated IAM users
  limited to one Storage Space and one selected permission level.
- Portal storage-admin requests:
  `/portal/requests*` for the current user's submissions and
  `/admin/portal-requests*` for Admin review, messages, approval, and rejection.
- Super-admin Portal override governance:
  `/admin/accounts/{accountId}/portal-settings`.

Native IAM access keys, IAM compliance remediation, bucket-user grants, and
bucket-centric administration should be implemented in Manager or Admin when
they are needed by operators.

## Portal Data Flow

Portal uses thin FastAPI route handlers in `backend/app/routers/portal.py` and
keeps business logic in `PortalService`. Portal request routes live in
`backend/app/routers/portal_requests.py` and
`backend/app/routers/admin/portal_requests.py`; all request business logic stays
in `PortalRequestsService`. The frontend API clients are
`frontend/src/api/portal.ts` and `frontend/src/api/portalRequests.ts`, and
production Portal pages live under `frontend/src/features/portal`.

The current backend flow is:

1. Resolve the authenticated UI user and Portal account binding.
2. Resolve visible Storage Spaces from `portal_storage_space_metadata`,
   ownership, Portal manager status, visibility, share scope, archive state,
   effective account membership, and DB grants. Buckets without Portal metadata
   are not Storage Spaces.
3. Map private owners to `Owner`, project managers to `Manager`, and team
   collaborators to `Viewer` or `Editor`. Portal managers have full content
   access to every project Storage Space.
4. Block archived Storage Spaces from Portal object routes, embedded Browser
   bucket targets, sharing, and public-link downloads.
5. Execute file and sharing operations with the Portal execution identity.
   The locked Browser embed must send `X-S3-Workspace: portal` so `/browser`
   routes resolve Portal credentials and enforce the minimal file profile.
6. Apply platform-owned bucket defaults and synchronize code-owned IAM group,
   user, and bucket-policy projections from database state. The manager group
   grants account-wide Storage Space data access; technical buckets deny the
   individual manager principals with resource policies.
7. Record mutating Portal actions through audit logging.
8. Return user-facing shapes without policy JSON, principals, ARNs, or
   advanced S3 diagnostics.

Portal request approvals are Admin-owned mutations. A Portal user creates a
typed payload on `/portal/requests`, then an Admin approves, rejects, or sends
messages from `/admin/portal-requests`. Approval must use `processing` to avoid
double execution, audit the decision, notify the requester in-app, and either
link/create the requested Portal UI user, remove a Portal user link, or apply
the target account capacity quota through the existing account service. Portal
must block quota targets below the currently used capacity when that usage is
known.

Storage Space remains an API/UI abstraction. In v1 it maps to a bucket, but the
UI must keep the Storage Space label so future project, dataset, or workspace
concepts can be introduced without another surface rewrite.

## Portal Test Group

Use focused Portal validation before broader suites:

- Frontend Portal unit and route checks, from `frontend/`:
  `rtk npm run test:portal`
- Frontend typecheck, from `frontend/`:
  `rtk npm run typecheck`
- Frontend dead-code check, from `frontend/`:
  `rtk npm run deadcode:check`
- Backend Portal service and route-contract checks:
  `rtk env PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/test_portal_service.py backend/tests/test_manager_workspace_access_rules.py -q`
- Backend Portal request workflow checks:
  `rtk env PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/test_portal_requests_service.py backend/tests/test_portal_requests_routes.py -q`
- Diff hygiene:
  `rtk git diff --check`

The Portal backend tests include permission regressions for `Viewer`, `Editor`,
and `Owner` across object detail/download/delete, sharing, and removed advanced
settings routes. Simple file listing, upload, and folder creation for Storage
Spaces are covered through the locked Browser profile.

## Portal Fallback Policy

Production Portal pages use real Portal APIs first. When a backend capability
is absent, the UI must show an empty or unavailable state instead of generated
production-looking data.

Allowed deterministic fixture data is limited to tests, docs screenshots, and
isolated demo setup. It must not be imported by production Portal pages.

## Portal Visual QA

Portal has a deterministic local QA scenario in the docs screenshot
Playwright setup:

- authenticated user: `storage.user@example.com`;
- selected Portal account: `Helios Retail` (`selectedPortalAccountId=101`);
- fixture Storage Spaces: `genomics-2026`, `photos`, and `datasets`;
- fixture shares, activity, transfers, alerts, traffic, usage, billing source,
  and locked Browser object listing data;
- no live storage credentials or backend state are required.

The reference desktop screenshots are generated by `npm run docs:screenshots`
from `frontend/` and are committed under
`doc/docs/assets/screenshots/user/` for:

- `workspace-portal`;
- `portal-storage-spaces`;
- `portal-object-list`;
- `portal-object-detail`;
- `portal-usage`;
- `portal-access-keys`;
- `portal-settings`.

`portalVisualQa.spec.ts` also opens these Portal routes in desktop and mobile
viewports:

- `/portal`
- `/portal/storage-spaces`
- `/portal/storage-spaces/genomics-2026?prefix=raw-data%2F2024%2F03%2F`
- `/portal/storage-spaces/genomics-2026/objects/raw-data/2024/03/sample_001.fastq.gz`
- `/portal/shares`
- `/portal/history`
- `/portal/history?view=transfers`
- `/portal/usage`
- `/portal/requests`
- `/portal/access-keys`
- `/portal/settings`

The QA test checks that the main content renders, the page does not expose
`/portal/browser`, the locked Storage Space file browser renders without
advanced Browser entry points, the document does not create viewport horizontal
overflow, and keyboard focus can leave the body on the first tab.
Mobile screenshots are not committed; mobile coverage is kept as a lightweight
automated viewport check to avoid expanding the documentation image set.

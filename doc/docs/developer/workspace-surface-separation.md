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
| `/browser` standalone | Selected Browser context: S3 account, S3 connection, legacy S3 user, session context, or Portal account context. | Classic root Browser uses `browser_enabled` and `browser_root_enabled`; Portal account contexts use `browser_enabled`, `portal_enabled`, and `browser_portal_enabled` with `X-S3-Workspace: portal`. User or group `browser_advanced_features_enabled` controls advanced chrome on the root route. | Root Browser is enabled by default. When advanced Browser access is false, `/browser` uses Manager-equivalent compact chrome: no folder panel, no inspector panel, no action bar toggle, no root-only column/layout controls, and no bucket creation shortcut. Portal account contexts use a user-oriented workspace sidebar, display Storage Space names instead of bucket names, and keep the `portal-basic` action profile. | Good default for technical users and Portal users who need a broader file workspace. Portal context must stay read/file-oriented and must not expose account-management features. |
| `/manager/browser` embedded Browser | Active Manager execution context. | `browser_enabled`, `browser_manager_enabled`, and the selected S3 connection `access_browser` flag when the context is a connection. | Disabled by default. Even when enabled, it uses embedded compact chrome: no folders panel, no inspector panel, no panel toggles, and no Browser-owned bucket management shortcut. | Useful only when object navigation must stay close to Manager context. Keep disabled when Manager should remain a configuration surface only. |
| `/portal/storage-spaces/:spaceId` locked Browser | Portal execution identity resolved for the selected account and DB-backed Storage Space. | `browser_enabled`, `browser_portal_enabled`, `portal_enabled`, Portal account role, `X-S3-Workspace: portal`, active Storage Space visibility, DB grant role, content role, and the `portal-basic` profile. | Enabled by default but locked to one active Storage Space. Bucket switching and bucket search are hidden and backend bucket lists are filtered to active Storage Spaces with Portal metadata and content access. Backend allows only the basic Portal route subset: settings, bucket search, object list/download/CORS, presign/delete/folders/proxy upload, and multipart upload lifecycle calls. UI action allowlist keeps upload files, upload folder, new folder, copy path, details, download, delete, and opening a single folder. Viewer Storage Spaces hide upload, folder creation, and delete actions. The details action routes to the Portal object detail page, not the advanced Browser modal. | This is the current minimal end-user file profile. Archived Storage Spaces must be blocked even if older Portal credentials still have storage-side access. Portal managers may list and administer a private Storage Space without content access when they are not its owner. Backend Portal checks use DB metadata and grants; IAM policies are projection/enforcement for S3 keys, not the source for listings or roles. |
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
| Versioning, deleted-object, restore, and cleanup tools | Version listing, restore-to-date, deleted-object display, and cleanup are powerful and potentially destructive. | Actions are visible only when bucket versioning is enabled. Portal backend route allowlist excludes object-version endpoints and Portal basic removes version actions. | Disabled in Portal Browser. Hidden for buckets without versioning. | Consider admin-only or advanced-only gates for cleanup and restore operations even in full Browser profiles. |
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

Root `/browser` may also run in a Portal account context. In that mode the
workspace stays on `/browser`, sends `X-S3-Workspace: portal`, and lists visible
Storage Spaces in the Browser workspace sidebar. The UI must display Storage
Space names only; internal bucket names remain execution identifiers for API
calls and must not appear in Portal-facing sidebar rows or current-selection
labels. Usage and metrics affordances are read-only and optional: if reliable
usage is unavailable, the footer gauge is hidden rather than replaced with a
placeholder.

## Portal Rules

- Keep Portal labels user-oriented: `Storage Spaces`, `Shares`, `Activity`,
  `Transfers`, `Storage health`, `Help requests`, and `Settings`.
- Do not add a `/portal/browser` route. Portal may embed the main Browser on
  `/portal/storage-spaces/:spaceId`, in a locked Storage Space context with the
  `portal-basic` action profile and `X-S3-Workspace: portal`. Portal users may
  also access root `/browser` through Portal account contexts when the Portal
  Browser feature flag is enabled.
- Do not use Portal as a shortcut to Manager configuration.
- Do not expose policy documents, principals, ARNs, advanced ACLs, object
  diagnostics, bucket defaults, lifecycle, CORS, replication, or versioning in
  Portal UI text.
- Do not reintroduce a Storage Space `Type` field. Use `visibility` for
  `private` or `shared`, `share_scope` for restricted versus all-account
  sharing, and `archived_at`/`status` for archived state.
- Portal user Storage Space creation is exposed through the dedicated
  `can_create_storage_spaces` Portal state flag. Do not reuse
  `can_manage_buckets` for portal-user creation UI, because bucket management
  remains a broader portal-manager/operator capability.
  `portal_user` requests must create `private` Storage Spaces only. A
  `portal_manager` can create `private` or `shared` Storage Spaces regardless
  of the portal-user creation flag; named bucket mode still requires the named
  bucket creation setting.
- Private Storage Spaces are visible only to their owner and Portal managers.
  Portal managers can edit metadata, visibility, and archive state for those
  spaces, but content access, object routes, Browser bucket filters, and IAM
  projections must exclude private spaces owned by another user.
  Shared Storage Spaces either use DB-backed Viewer, Editor, and Owner grants
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
  statements. The Portal role templates for `Viewer`, `Editor`, and `Owner`
  are code-owned backend projections from DB grants; they are not an editable
  bucket/IAM policy document in Portal.
- The default `portal-manager` IAM group policy must stay limited to global
  Portal bootstrap actions such as `s3:ListAllMyBuckets` and
  `sts:GetSessionToken`. Do not reintroduce `iam:*`, `s3:*`,
  `s3:CreateBucket`, or bucket-configuration actions there to compensate for
  missing service orchestration.
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
- `/portal/activity`
- `/portal/transfers`
- `/portal/usage`
- `/portal/requests`
- `/portal/settings`

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
3. Map Storage Spaces to a user-facing management role and a separate content
   role. Portal managers get management `Owner` on every Storage Space, but
   content access comes only from ownership, all-account scope, or explicit
   grants.
4. Block archived Storage Spaces from Portal object routes, embedded Browser
   bucket targets, sharing, and public-link downloads.
5. Execute file and sharing operations with the Portal execution identity.
   The locked Browser embed must send `X-S3-Workspace: portal` so `/browser`
   routes resolve Portal credentials and enforce the minimal file profile.
6. Apply platform-owned bucket defaults and synchronize IAM projections from
   the DB grants through backend orchestration with the account credentials,
   not by widening the `portal-manager` group policy or exposing
   `bucket_access_policy` as a Portal permission control.
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
- `/portal/activity`
- `/portal/transfers`
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

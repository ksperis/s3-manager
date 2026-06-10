# Workspace Surface Separation

## Purpose

The product exposes distinct workspaces for distinct jobs. A feature should be
placed in the narrowest surface that matches the user's intent and the required
execution identity.

## Surfaces

- `/portal` is the end-user Storage Workspace. It is centered on storage spaces,
  simple file operations, shares, activity, transfers, usage, alerts, and user
  preferences.
- `/browser` is the advanced object explorer. It owns bucket/object diagnostics,
  versions, metadata, tags, batch operations, advanced object actions, and
  technical S3 inspection workflows.
- `/manager` is the S3 and account configuration workspace. It owns native S3
  and identity configuration, bucket properties, policies, users, groups, roles,
  lifecycle, replication, notifications, and topics.
- `/admin` is the platform administration workspace. It owns UI users,
  endpoints, accounts, global quotas, billing administration, feature flags,
  audit, health, and governance.

## Portal Rules

- Keep Portal labels user-oriented: `Storage Spaces`, `Shares`, `Activity`,
  `Transfers`, `Usage & Analytics`, and `Settings`.
- Do not add a `/portal/browser` route. Portal may embed the main Browser only
  on `/portal/storage-spaces/:spaceId`, in a locked Storage Space context with
  the `portal-basic` action profile and `X-S3-Workspace: portal`.
- Do not use Portal as a shortcut to Manager configuration.
- Do not expose policy documents, principals, ARNs, advanced ACLs, object
  diagnostics, bucket defaults, lifecycle, CORS, replication, or versioning in
  Portal UI text.
- Keep storage permissions backed by the existing storage-side permissions. UI
  roles such as `Viewer`, `Editor`, and `Owner` are presentation and workflow
  terms, not a parallel permission model.

## Routing Contract

Portal canonical routes are:

- `/portal`
- `/portal/storage-spaces`
- `/portal/storage-spaces/:spaceId`
- `/portal/storage-spaces/:spaceId/objects/*`
- `/portal/shares`
- `/portal/activity`
- `/portal/transfers`
- `/portal/usage`
- `/portal/settings`

Portal administration mock pages such as `/portal/users`, `/portal/groups`,
`/portal/policies`, and `/portal/access-keys` are intentionally not routed in
the production Portal surface. They can return later only as real user-facing
Portal features or isolated demo/test fixtures.

## Portal Backend Cleanup Notes

Portal uses Storage Space, file, share, activity, transfer, usage, alert,
billing-source, health, and simple settings endpoints only. Legacy backend
routes that exposed bucket-centric or advanced identity concepts have been
removed from the Portal router and API client:

- `/portal/buckets*`;
- `/portal/bootstrap`;
- `/portal/users*` bucket-grant and Portal user-management routes;
- `/portal/access-keys*`;
- `/portal/account-settings`;
- `/portal/iam-compliance*`.
- `/portal/settings` advanced Portal settings payloads.

Use `/portal/storage-spaces*` and `/portal/storage-spaces/{spaceId}/shares*`
for end-user collaboration workflows. Use `/admin/accounts/{accountId}/portal-settings`
for Portal override governance. Native IAM, policy compliance, access-key, and
bucket administration workflows belong outside the Portal user surface. Future
Portal preferences should use a simple user-preference contract, not the
advanced Portal settings payload.

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
- Portal override governance:
  `/admin/accounts/{accountId}/portal-settings`.

Native IAM access keys, IAM compliance remediation, bucket-user grants, and
bucket-centric administration should be implemented in Manager or Admin when
they are needed by operators.

## Portal Data Flow

Portal uses thin FastAPI route handlers in `backend/app/routers/portal.py` and
keeps business logic in `PortalService`. The frontend API client is
`frontend/src/api/portal.ts`, and production Portal pages live under
`frontend/src/features/portal`.

The current backend flow is:

1. Resolve the authenticated UI user and Portal account binding.
2. Resolve visible Storage Spaces from the existing storage-side permissions.
3. Map Storage Spaces to a user-facing role: `Viewer`, `Editor`, or `Owner`.
4. Execute file and sharing operations with the Portal execution identity.
   The locked Browser embed must send `X-S3-Workspace: portal` so `/browser`
   routes resolve Portal credentials and enforce the minimal file profile.
5. Record mutating Portal actions through audit logging.
6. Return user-facing shapes without policy JSON, principals, ARNs, or
   advanced S3 diagnostics.

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
  `rtk env PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/test_portal_service.py -q`
- Diff hygiene:
  `git diff --check`

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
- `/portal/settings`

The QA test checks that the main content renders, the page does not expose
`/portal/browser`, the locked Storage Space file browser renders without
advanced Browser entry points, the document does not create viewport horizontal
overflow, and keyboard focus can leave the body on the first tab.
Mobile screenshots are not committed; mobile coverage is kept as a lightweight
automated viewport check to avoid expanding the documentation image set.

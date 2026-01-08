# Portal Refactor (/portal) — Architecture & Decisions

This document describes the new `/portal` architecture (backend + DB + UI) and the contract it enforces.

## Glossary

- **Actor**: the authenticated UI user initiating a workflow (the human).
- **Executor**: the principal that performs the mutating operation against RGW/S3/IAM (STS session, portal-managed IAM user, bucket-provisioner, etc.).
- **Workflow**: a named unit of intent (ex: `external_access.enable`, `packages.assign`, `bucket.create`).
- **Delta**: structured, secret-free description of what changed (inputs + derived resources).
- **Portal-only access**: user can use the portal UI; no IAM user/keys are provisioned for external clients.
- **External access**: opt-in IAM identity + access keys exist for the user; permissions are materialized in IAM/S3.
- **Integrated access**: in-UI bucket/object browsing performed with either STS temporary credentials (preferred) or presigned URLs (fallback).
- **Account**: an IAM account (tenant) represented by `s3_accounts(kind="iam_account")`.

## Non-negotiable constraints (enforced)

- `/portal` is strictly **account-scoped** (no cross-tenant operations).
- `/portal` supports **IAM-account** tenants only (no legacy standalone users in portal).
- Never log secrets (JWTs, access keys, secret keys, passwords).
- IAM is the source of truth for external access (no parallel permission system).
- Actor/Executor separation is mandatory for every mutating portal workflow.
- `/manager` and the existing `/browser` surface remain thin explorers (no portal abstractions in `/manager`).

## Multi-account UX

- `/portal` requires a selected `account_id` (tenant scope) before pages load.
- If the user has **one** portal account → enter directly.
- If the user has **multiple** portal accounts → show an account selection screen before any page renders.
- A global account switcher is displayed in the portal topbar:
  - remembers the last selected account in `localStorage` (`selectedPortalAccountId`),
  - switching account refreshes RBAC + endpoint capabilities + visible menu items,
  - each account displays badges:
    - portal role (Viewer / AccessAdmin / AccountAdmin),
    - access mode (Portal-only / External enabled),
    - endpoint capability (STS / Presigned fallback).

## API scoping contract (mandatory)

- Backend API routes are under `GET/POST /api/portal/*` (frontend route is `/portal`).
- Every `/api/portal/*` endpoint that reads/writes tenant data is scoped to an `account_id` (query param).
- The backend resolves a **PortalContext**:
  - actor identity (UI user),
  - selected account (must be `s3_accounts.kind="iam_account"`),
  - endpoint capabilities (STS/presign/external/allowed packages),
  - effective portal permissions.
- Scope enforcement:
  - `account_id` is required unless the user has exactly one portal account (then it is inferred).
  - any mismatch or missing membership → 403.

## STS vs Presigned policy (mandatory)

### When `sts_enabled=true`

- Integrated browser uses **STS temporary credentials** (via `GET /api/portal/browser/sts/credentials`).
- UI shows session state (active/expired + expiration) and provides Refresh.

### When `sts_enabled=false`

- Integrated browser uses **presigned URLs** for `GET` / `PUT` (via `POST /api/portal/browser/buckets/{bucket}/presign`).
- Guaranteed (Basic Mode):
  - download (presign GET)
  - single PUT upload (presign PUT)
- Listing and delete are implemented safely:
  - list is served via backend API (`GET /api/portal/browser/buckets/{bucket}/objects`)
  - delete is performed via backend API (`POST /api/portal/browser/buckets/{bucket}/delete`)
- UI keeps STS vs presigned mostly transparent; details appear only under Advanced mode / explanations.

## Browser reuse decision (initial)

- Reuse the existing **browser service patterns** (thin router → service → S3 client), but expose a **portal-scoped** API surface.
- Avoid copying `/manager/browser` semantics into `/portal`; `/portal` has its own RBAC gates and capability-based behavior.
- Frontend reuses browser UI building blocks where possible, while implementing a simpler Basic Mode first.

## Data model (high-level)

This is the target portal-oriented schema. Migrations preserve existing users and keep the application bootable.

- `s3_accounts.kind`: `iam_account | legacy_user`
  - `/portal` can reference only `iam_account`.
- Associations
  - `portal_memberships`: user ↔ account (portal access + portal role)
  - `manager_root_access`: user ↔ account (root /manager access)
- RBAC
  - `portal_roles`, `portal_permissions`, `portal_role_bindings` (account-wide, with bucket/prefix-ready scopes)
  - delegated levels:
    - Viewer
    - AccessAdmin
    - AccountAdmin
  - guardrails: `allowed_packages` on endpoint and/or account.
- Endpoint capabilities persisted (on `storage_endpoints`):
  - `sts_enabled` (via features config)
  - `presign_enabled`
  - `allow_external_access`
  - `max_session_duration`
  - `allowed_packages`
- External identities
  - `iam_identities`: optional, created only when enabling external access
  - `access_grants`: assigns packages to `iam_identities` (bucket + optional prefix)
- Audit
  - extend `audit_logs` to store: surface, workflow, actor, target, executor_type, executor_principal, delta, status/error.

## Endpoint Configuration (Admin)

Portal capabilities are configured per storage endpoint (and reflected in `/api/portal/accounts` badges and `/api/portal/context`):

- `storage_endpoints.features_config`:
  - `features.sts.enabled=true` enables integrated STS sessions.
- `storage_endpoints.presign_enabled`:
  - gates presigned URL operations (`/api/portal/browser/*/presign`).
- `storage_endpoints.allow_external_access`:
  - gates external access workflows (`/api/portal/access/*/enable|rotate|revoke`).
- `storage_endpoints.allowed_packages`:
  - delegated admin guardrails (restrict `AccessAdmin` package assignment).
- `storage_endpoints.max_session_duration`:
  - caps portal STS sessions (900–43200 seconds).

## What’s Implemented (Basic Mode)

### Portal shell & navigation

- New `/portal` UI shell with account switcher and RBAC-aware navigation.
- New API entry points:
  - `GET /api/portal/accounts` (multi-account selector + badges)
  - `GET /api/portal/context` (permissions + endpoint capabilities)

### Integrated browser (Basic)

- Buckets: `GET /api/portal/browser/buckets`
- Browse objects/prefixes: `GET /api/portal/browser/buckets/{bucket}/objects`
- Upload/download:
  - STS mode: UI uses `GET /api/portal/browser/sts/credentials` and talks directly to S3 with temporary credentials.
  - Presigned fallback: `POST /api/portal/browser/buckets/{bucket}/presign` for `put_object` / `get_object`.
- Safe server-side operations:
  - Delete: `POST /api/portal/browser/buckets/{bucket}/delete`
  - Proxy upload/download endpoints exist for endpoints where presign is impractical:
    - `POST /api/portal/browser/buckets/{bucket}/proxy-upload`
    - `GET /api/portal/browser/buckets/{bucket}/proxy-download`

### External access (opt-in)

- Enable external access provisions a portal-managed IAM user + initial key; secret is returned once and never stored in plaintext:
  - `POST /api/portal/access/me/enable`
  - `POST /api/portal/access/me/rotate`
  - `POST /api/portal/access/me/revoke`
- Team management (AccessAdmin / AccountAdmin):
  - `POST /api/portal/access/users/{id}/enable|rotate|revoke`
  - `POST /api/portal/access/grants` and `DELETE /api/portal/access/grants/{user_id}/{grant_id}`
- IAM identity naming (deterministic):
  - external IAM user: `ptl-<account-db-id>-<user-id>`
  - package materialization group: `portal-<account-db-id>-<package>-<bucket>-<hash>`

### Access packages & grants

- Implemented packages (bucket-scoped):
  - `BucketReadOnly`
  - `BucketReadWrite`
  - `BucketAdmin`
- Prefix-scoped grants are explicitly rejected for now (`prefix` is TODO).
- Guardrails:
  - `AccessAdmin` is restricted by `storage_endpoints.allowed_packages`.

### Bucket provisioning (Actor/Executor)

- `POST /api/portal/buckets` creates a bucket via a dedicated executor identity:
  - bucket-provisioner IAM user: `portal-<account-db-id>-bucket-provisioner`
  - executor credentials are stored encrypted on the account (`s3_accounts.bucket_provisioner_*`)
  - required bucket tags:
    - `managed-by=portal`
    - `portal-account=<account-db-id>`
    - `portal-scope=bucket`
    - `workflow=bucket.create`
- Every portal mutation writes an audit entry with `actor`, `workflow`, and `executor_*` fields (no secrets).

## Migration strategy (outline)

- Add new tables/columns, keeping legacy tables readable during migration.
- Backfill `s3_accounts.kind` based on existing data.
- Migrate existing portal-related flags (`user_s3_accounts.*`, `account_iam_users`) into:
  - `portal_memberships`
  - `iam_identities` (without storing secrets)
  - initial default portal roles/bindings
- Keep the app bootable at every migration step; no feature flag is required because the old portal is removed.

## Managed resource conventions (mandatory)

To avoid collisions and enable auditability, all portal-managed RGW/IAM resources and bucket defaults must be identifiable via deterministic naming and (when supported) tags/metadata:

- `managed-by=portal`
- `portal-account=<account-id>`
- `portal-scope=bucket|prefix`
- `portal-package=<package-key>`
- `workflow=<workflow-name>`

E2E resources must be prefixed: `ptl-e2e-<timestamp>-...`

## TODOs (risk-managed)

Advanced browser features (multipart, versions, object lock, lifecycle editor, batch ops, complex copy/rename) must not block Basic Mode.
Any deferred work is documented in code comments and in this doc once the implementation lands.

Known TODOs / limitations:

- Prefix-scoped access grants (`access_grants.prefix`) are not implemented yet.
- Group/policy cleanup is best-effort on revoke (groups/policies are intentionally left for now; account teardown removes everything).

## How to Run

### Migrations

- Apply migrations as usual for the backend (Alembic). The portal refactor introduces new tables and columns (see `backend/alembic/versions/0003_portal_refactor_schema.py` and `backend/alembic/versions/0004_portal_bucket_provisioner_executor.py`).

### Unit / integration tests (local)

```bash
cd backend
python -m pytest -m "not ceph_functional"
```

### Live Ceph RGW validation (manual, ceph_functional)

Portal E2E scenarios live under `backend/tests_ceph_functional/test_portal_flow.py` and are opt-in (skipped when env vars are missing).

```bash
export CEPH_TEST_BACKEND_BASE_URL="https://manager.example.com/api"
export CEPH_TEST_SUPERADMIN_EMAIL="admin@example.com"
export CEPH_TEST_SUPERADMIN_PASSWORD="your-secret"

python backend/tests_ceph_functional/run_portal.py
```

Notes:

- Resources are prefixed with `ptl-e2e-<timestamp>-...` and cleaned up automatically.
- The portal suite may temporarily toggle `storage_endpoints.features_config` (STS enable/disable) and restores it after each test.

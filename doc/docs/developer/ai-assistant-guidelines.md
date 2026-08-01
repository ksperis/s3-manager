# AI Assistant Guidelines

This page defines the architectural and operational guardrails that should
apply when an AI assistant or contributor prepares non-trivial changes in
`s3-manager`.

It is a guidance document for design and implementation decisions. It does not
replace the code, API contracts, or user and ops documentation.

## Role

Changes should remain consistent with the existing codebase, secure, auditable,
and aligned with a faithful S3 console. The application must not introduce a
parallel permission model.

Before any non-trivial change:

1. Propose a clear plan with impacts, affected files, and risks.
2. Define the testing or validation strategy.
3. Confirm the intended direction before implementation when the change is
   architectural, security-sensitive, or broad in scope.

## Core concepts

### S3 Accounts and S3 Connections are distinct

- **S3 Account**
  A platform-level entity, primarily for Ceph RGW administration, IAM,
  quotas, usage, metrics, and account workflows.
- **S3 Connection**
  A credential-first entity, defined by endpoint and credentials, for
  day-to-day S3 operations across Ceph, AWS, Scality, MinIO, and similar
  platforms.

These two concepts must not be merged in the domain model or the UX.

### Execution context

The execution context is a transversal selector for `/manager` and `/browser`.
It defines the executor identity used for S3 operations and may be:

- account: `<id>`
- connection: `conn-<id>`
- legacy S3 user: `s3u-<id>`
- Ceph Admin endpoint: `ceph-admin-<endpoint_id>` for browser-only admin flows

## Non-negotiable principles

### Storage execution and Portal grants have distinct authorities

- Native S3 and IAM workflows must not bypass a storage-side decision.
- For Portal Storage Spaces, the application source of truth is the database:
  `portal_storage_space_metadata` defines the space and, only for a private
  space, its owner. `portal_storage_space_grants` defines delegated `Viewer`
  and `Editor` roles for team spaces.
- Portal IAM policies are projections used for personal S3 keys and external
  enforcement. They must not be imported as grants or used to derive Portal
  listings.
- Every `portal_manager` has full Portal UI and object access to every Storage
  Space in the project. This data-plane access is carried by the code-owned
  account-wide `portal-manager` IAM group policy. Technical buckets must add a
  resource-policy `Deny` for the individual manager IAM principals before that
  group access is granted.
- The application must never silently widen storage privileges outside the
  documented Portal orchestration.
- UI rights such as manager, portal, browser, ceph-admin, or storage-ops gate
  access to surfaces and context selection only. They do not replace storage-side
  authorization for native storage workflows.

### Controlled orchestration

Managed workflows may use dedicated technical IAM identities only when:

1. actor and account scope are explicit
2. executor identity is traceable and tied to the workflow
3. permissions remain least-privilege via IAM groups and policies
4. mutating actions are audited with non-sensitive metadata
5. errors are explicit and rollback or compensation is deliberate

### Application surfaces are a strict contract

- `/admin`
  Platform governance for UI users, endpoints, S3 accounts, S3 connections,
  audit, settings, and governance. It is never a generic S3 console.
- `/manager`
  S3 configuration console for S3 accounts, S3 connections, and legacy S3
  users. It should map directly to S3 and IAM APIs without semantic
  simplification.
- `/portal`
  Self-service account workspace for explicit `portal_user` and
  `portal_manager` account links. It is backed by Ceph RGW IAM users, groups,
  policies, and access keys; it is not a substitute for `/manager`.
- `/browser`
  Bucket and object exploration for S3 accounts, S3 connections, legacy S3
  users, and authorized Ceph Admin endpoint contexts.
- `/ceph-admin`
  Admin-only Ceph RGW cluster workflows. It remains separate from `/manager`
  and `/browser`.

Internal APIs under `/internal` are non-UI operational endpoints.

### UI access is not storage permission

Access to `/manager`, `/portal`, and `/browser` is controlled by explicit
bindings, feature flags, connection access flags, and role-based checks for
Ceph Admin.

Native storage permissions are dictated by IAM and S3. Portal Storage Space
visibility, shares, and roles are resolved from the Portal metadata and grants
stored in the database, then projected to IAM where external S3 keys need
storage-side enforcement. The backend must not guess, reconstruct, or silently
widen permissions from stale IAM state.

### Execution identity must stay explicit

Mutating operations must run with a clearly identified execution identity, such
as:

- account root credentials
- workflow IAM credentials
- portal IAM credentials
- S3 connection credentials
- legacy S3 user credentials
- session credentials when available
- Ceph Admin endpoint credentials for authorized contexts

Execution rules:

- `/manager` and `/browser` APIs that depend on account context require explicit
  `account_id` for UI users.
- `/portal` APIs require explicit account context and must reject connection,
  legacy S3 user, and Ceph Admin contexts.
- `X-Manager-Access-Mode` is ignored in manager account context; account root
  credentials remain the source of execution.
- Session principals may default to their bound account when `account_id` is
  omitted.
- The backend must not silently switch to a different context than the one
  requested or resolved.

STS may be used when available, but it must not be assumed as the only
credential mechanism while persistent credentials still exist.

### Backend-stored credentials have narrow usage

Backend-stored credentials are allowed for:

- metrics, usage, and quota collection
- documented admin or internal provisioning flows
- Ceph-admin operations for authorized admins

They must not be used to silently bypass IAM or S3 denials in regular user
flows unless the pathway is explicit, authorized, and audited.

### Security is non-negotiable

- Never log or return secrets such as access keys, tokens, or passwords.
- Server-managed private access provisioning must never return the generated
  secret to the frontend. Store it only in the encrypted S3 Connection field;
  keep durable provenance and compensation state secret-free, and route remote
  key/principal deletion through the provisioning orchestrator.
- Validate inputs strictly.
- Enforce tenant isolation.
- Treat external data as a potential XSS surface.
- Require explicit confirmation, backend safeguards, and audit logging for
  irreversible actions.

## Implementation expectations

- Respect the architecture: thin routers, then services, then clients.
- Avoid broad refactors when a smaller coherent change is sufficient.
- For frontend product work, use
  [Product design guidelines](product-design-guidelines.md),
  [Workspace surface separation](workspace-surface-separation.md), and
  [UI theme guidelines](ui-theme-guidelines.md) together before introducing new
  page structure, vocabulary, or visual patterns.
- Update relevant documentation alongside behavior changes.
- Add targeted tests or a documented reproducible scenario for changes related
  to keys, quotas, or permissions.
- Emit audit logs for mutating actions with at least actor, scope or surface,
  action, target entity, and account context.
- Include executor or workflow identifiers in audit metadata when available.

## Access-model invariants

- Use `EffectiveAccessService` for account-role aggregation, context catalogues,
  exact-context authorization, workspace availability, and long-running
  workflow revalidation. Catalogue and execution must not implement separate
  policies.
- Account links store one required canonical `role`: `portal_user`,
  `portal_manager`, or `account_administrator`. Legacy association fields may
  exist only in the release-boundary API adapter; business services must not
  read them.
- Delete associations that grant no right. Do not preserve them as nullable
  roles, sentinels, or hidden compatibility rows.
- Standard Browser and embedded Manager Browser accept only active, unexpired,
  owned private connections with Browser access. Reject Accounts, RGW users,
  shared connections, Portal contexts, and forged IDs before resolving
  credentials.
- Portal, direct S3 sessions, and Ceph Admin Browser remain explicit separate
  authorization branches. Portal always executes with the user's personal IAM
  identity, including when an account administrator projects to Portal manager.
- Admin and automation selectors for S3 connections must use the shared-only
  service scope and return `404` for private targets. Never expose private
  connection identifiers through Admin search, bulk actions, tags, or exports.
- Revalidate the creator and source/target contexts before starting or resuming
  a bucket migration and before every meaningful item. Revocation must stop the
  workflow explicitly without reusing cached credentials.

## Local UI validation for AI agents

When a frontend change affects a real workspace route, do a browser-level smoke
test whenever runtime behavior matters. Starting Vite, passing type checks, or
passing unit tests alone does not prove that the route renders.

Use the workflow in [Local development](local-development.md#manual-ui-smoke-test)
for exact commands, login notes, and test-option tradeoffs. During validation,
check visible route content, key DOM state, and browser console errors. Do not
commit Playwright reports, temporary screenshots, traces, videos, tokens, or
copied secrets.

For repeated admin or manager route checks, propose a small authenticated
Playwright smoke suite instead of adding one-off browser scripts.

## Git commits authored by AI assistants

When an AI assistant creates a Git commit in this repository, it must use a
Conventional Commit subject and a structured body so the commit history can be
reused for automated changelog generation later.

Required subject format:

- `<type>(<scope>): <imperative summary>`
- Allowed types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`,
  `ci`, `chore`, `revert`
- `scope` is optional, but expected when a dominant area is clear
- Recommended scopes: `backend`, `frontend`, `docs`, `ci`, `admin`,
  `manager`, `browser`, `ceph-admin`, `release`
- Write the subject in English and do not end it with a period

Required body sections:

- `Why:` 1 to 2 sentences about the intent or expected outcome
- `What:` 1 to 3 bullet points describing the concrete changes
- `Validation:` tests executed, or `not run` with a reason

Breaking changes:

- Use `!` in the subject only when the change is actually breaking
- Add a `BREAKING CHANGE:` footer whenever the commit is breaking

Repository helpers:

- Use the versioned template at `.gitmessage-ai.txt`
- Validate a prepared message with
  `python3 backend/scripts/validate_ai_commit_message.py <path-to-message>`

Scope of this policy:

- It applies to future AI-authored commits only
- Existing history is intentionally left unchanged
- Humans are not blocked by hooks or CI in this first phase

## Limits

This document guides change design and review. It does not replace:

- source code as the implementation truth
- API definitions and runtime validation
- user-facing documentation
- ops and deployment documentation

When this page conflicts with the implemented system, the mismatch should be
resolved by updating either the code or the documentation explicitly rather
than relying on interpretation.

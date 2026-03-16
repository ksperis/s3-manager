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

### IAM and S3 remain the source of truth

- No S3 or IAM action may bypass an IAM or S3 decision.
- The application must never "fix" IAM or invent privileges.
- UI rights such as manager, browser, ceph-admin, or storage-ops gate access to
  surfaces and context selection only. They do not replace storage-side
  authorization.

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
- `/browser`
  Bucket and object exploration for S3 accounts, S3 connections, legacy S3
  users, and authorized Ceph Admin endpoint contexts.
- `/ceph-admin`
  Admin-only Ceph RGW cluster workflows. It remains separate from `/manager`
  and `/browser`.

Internal APIs under `/internal` are non-UI operational endpoints.

### UI access is not storage permission

Access to `/manager` and `/browser` is controlled by explicit bindings, feature
flags, connection access flags, and role-based checks for Ceph Admin.

Actual storage permissions are dictated by IAM and S3. The backend must not
guess, reconstruct, or silently widen those permissions.

### Execution identity must stay explicit

Mutating operations must run with a clearly identified execution identity, such
as:

- account root credentials
- workflow IAM credentials
- S3 connection credentials
- legacy S3 user credentials
- session credentials when available
- Ceph Admin endpoint credentials for authorized contexts

Execution rules:

- `/manager` and `/browser` APIs that depend on account context require explicit
  `account_id` for UI users.
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
- Validate inputs strictly.
- Enforce tenant isolation.
- Treat external data as a potential XSS surface.
- Require explicit confirmation, backend safeguards, and audit logging for
  irreversible actions.

## Implementation expectations

- Respect the architecture: thin routers, then services, then clients.
- Avoid broad refactors when a smaller coherent change is sufficient.
- Update relevant documentation alongside behavior changes.
- Add targeted tests or a documented reproducible scenario for changes related
  to keys, quotas, or permissions.
- Emit audit logs for mutating actions with at least actor, scope or surface,
  action, target entity, and account context.
- Include executor or workflow identifiers in audit metadata when available.

## Limits

This document guides change design and review. It does not replace:

- source code as the implementation truth
- API definitions and runtime validation
- user-facing documentation
- ops and deployment documentation

When this page conflicts with the implemented system, the mismatch should be
resolved by updating either the code or the documentation explicitly rather
than relying on interpretation.

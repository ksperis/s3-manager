
# Executors, execution context, and portal scope

An **executor** is the storage-side identity actually used to perform an operation.
An **execution context** is the UI-selected identity used to resolve the executor for `/manager` and `/browser`.
A **portal context** is a target scope for `/portal` workflows, never an executor.

## Why executors matter

The UI user is *never* the same thing as the storage identity.
This separation allows:

- shared administration consoles
- strong auditing
- multiple backends and credentials per user

## Executor types

Depending on backend and surface, executors may include:

- **Account root user**
  - Ceph RGW Accounts
  - Used for account-level admin and IAM bootstrap
- **IAM user**
  - Long-lived credentials
  - Scoped by IAM policies
- **STS assumed role / session credentials** (future-ready)
  - Time-limited, auditable execution
- **S3 Connection credentials**
  - Manager / Browser surfaces
  - Credential-first usage

## Execution context selection

Execution contexts are listed for a UI user via:

- `GET /api/me/execution-contexts`

Contexts aggregate:

- S3 Account bindings (Ceph RGW accounts)
- S3 Connection bindings (credential-first)
- legacy S3 users (when explicitly linked)

Capabilities are conservative and do not reveal credentials.

## Executor selection

Executor selection is driven by:

- surface (Admin / Manager / Browser / Portal)
- backend capabilities
- user entitlements

The backend enforces which executor types are allowed per route.

In `/portal`, the selected context is a **target account scope**; execution happens with
the portal's technical identity or an explicit workflow executor.

## Audit implication

Every audited action should record:

- UI identity
- executor identity
- target resource
- intent

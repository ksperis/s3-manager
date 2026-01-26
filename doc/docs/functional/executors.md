
# Executors and execution context

An **executor** is the storage-side identity actually used to perform an operation.

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
  - Browser surface
  - Credential-first usage

## Executor selection

Executor selection is driven by:

- surface (Admin / Manager / Browser / Portal)
- backend capabilities
- user entitlements

The backend enforces which executor types are allowed per route.

## Audit implication

Every audited action should record:

- UI identity
- executor identity
- target resource
- intent

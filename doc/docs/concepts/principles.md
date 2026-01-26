
# Core principles

This project is opinionated. These principles are non-negotiable because they protect operability,
security, and user trust.

## IAM is the source of truth

- Authorization decisions belong to **IAM/S3**, not the UI
- s3-manager must not “correct” IAM or invent privileges
- UI entitlements govern **who can access the UI**, and **which executor** can be used — not storage authorization

## No shadow permission model

- All storage changes must result in **standard S3/IAM resources**
- Avoid storing “hidden” permissions only understood by s3-manager

## Credential hygiene

- UI users should not need to manipulate S3 keys in normal workflows
- When keys are required (Browser surface), the UX must be explicit about scope and risk

## Auditability by design

- Every sensitive action must be attributable:
  - who initiated it (UI identity)
  - which backend identity/credential executed it
  - what was changed (target + intent)
  - when it occurred

See **Concepts → Auditability** for the current implementation notes and recommendations.

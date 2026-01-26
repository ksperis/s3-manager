
# Identity model (principals)

s3-manager intentionally separates:

1. **UI identities** (humans/groups authenticating to the web UI)
2. **Storage identities** (S3/IAM principals used to execute actions on the backend)

This prevents accidental coupling between SSO identities and S3 credentials.

## UI identity

UI identity is used for:

- authentication (OIDC, email/password, etc.)
- authorization to access surfaces (Admin / Manager / Browser / Portal)
- selecting which **executor** (storage identity) is allowed for a given action

## Storage principals

Depending on backend capabilities, storage principals can include:

- Account root user (Ceph Accounts)
- IAM users
- STS assumed roles / session credentials (future)
- legacy users (backend-specific)

## Practical implication

A single UI user may manage:

- multiple S3 Accounts
- multiple S3 Connections
- multiple storage endpoints

This is by design and enables both “platform console” and “S3 Browser” usage.


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

### UI roles and account links

UI roles define which surfaces a user can reach:

- `ui_admin`: platform-level admin surface access.
- `ui_user`: user surface access (Manager/Browser/Portal depending on account links).
- `ui_none`: no surface access.

Account links add per-account flags and portal roles:

- `account_role`: `portal_user`, `portal_manager`, or `portal_none`.
- `account_admin`: per-account admin flag (not a UI role).

A user is considered **portal-only** when they have at least one portal role
(`portal_user` or `portal_manager`) and **no** `account_admin` across all account links.

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

## Default landing after login

The UI redirects after login using the following rules:

- `ui_admin` -> `/admin`
- `ui_user` -> `/manager` by default
- `ui_user` portal-only -> `/portal`
- `ui_none` (or missing role) -> `/unauthorized`

If a surface is disabled by feature flags, the UI falls back to the next available surface.

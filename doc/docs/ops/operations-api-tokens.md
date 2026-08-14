# Operations: Admin API Tokens

Admin API tokens provide long-lived bearer authentication for automation.

## Key behavior

- Managed via `/api/auth/api-tokens`.
- Token value is shown once at creation.
- Revocation is immediate.
- Expiration is enforced server-side.
- Default lifetime is 30 days and the hard maximum is 90 days.
- Creation and revocation require recent WebAuthn verification.
- The JWT and database row must contain the same scopes and `auth_version`.
- Browser UI cookies cannot be combined with a Bearer token.

## Required scopes

Choose the minimum `read` and `write` scopes from `profile`, `admin`,
`manager`, `browser`, `portal`, `ceph-admin`, and `storage-ops`. A token is
denied on every protected route that has no explicit scope mapping.

## Runtime controls

- `API_TOKEN_DEFAULT_EXPIRE_DAYS`
- `API_TOKEN_MAX_EXPIRE_DAYS`

## Recommended operations practice

- Create dedicated tokens per automation scope.
- Store in secret manager.
- Rotate regularly and revoke on decommission.
- Recreate all API tokens after the authentication cutover migrations `0107`–`0110`.

## Related pages

- [Operations: Admin automation API](operations-admin-automation.md)
- [Operations: security](operations-security.md)

# Operations: Admin API Tokens

Admin API tokens provide long-lived bearer authentication for automation.

## Key behavior

- Managed via `/api/auth/api-tokens`.
- Token value is shown once at creation.
- Revocation is immediate.
- Expiration is enforced server-side.

## Runtime controls

- `API_TOKEN_DEFAULT_EXPIRE_DAYS`
- `API_TOKEN_MAX_EXPIRE_DAYS`

## Recommended operations practice

- Create dedicated tokens per automation scope.
- Store in secret manager.
- Rotate regularly and revoke on decommission.

## Related pages

- [Operations: Admin automation API](operations-admin-automation.md)
- [Operations: security](operations-security.md)

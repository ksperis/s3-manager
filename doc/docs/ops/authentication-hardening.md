# Authentication Security and Cutover

This page is the operating contract for browser sessions, API tokens, federation, WebAuthn, and the authentication cutover introduced by migrations `0107` through `0110`.

## Authentication classes

| Class | Transport | Lifetime | Server-side control |
|---|---|---|---|
| UI access | Host-only `HttpOnly`, `Secure`, `SameSite=Lax` cookie | 5 minutes | `auth_sessions` is checked on every request. |
| UI refresh | Host-only `HttpOnly`, `Secure`, `SameSite=Lax` cookie, `/api/auth` path | 12 hours idle, 7 days absolute | Single-use token families; replay revokes the entire family. |
| Direct S3 session | Same browser cookie contract | 30 minutes idle, 8 hours absolute | Revocation or expiry erases the stored S3 credentials. |
| API token | `Authorization: Bearer` | 30 days by default, 90 days maximum | Token hash, authentication version, expiration, revocation, and scopes are checked in the database. |
| Pre-authentication | Short `HttpOnly` cookie | 5 minutes | Only WebAuthn enrollment, WebAuthn authentication, or recovery-code completion is allowed. |

Browser requests must never send a Bearer token. A request containing both a UI cookie and a Bearer is rejected. Mutating cookie-authenticated requests require the exact configured `Origin` and a CSRF value bound to the session. Authentication responses use `Cache-Control: no-store`.

`GET /api/auth/session` is the browser identity source. Access and refresh tokens are never returned in UI login, LDAP, S3, OIDC, or refresh response bodies and must not be stored in `localStorage` or `sessionStorage`.

## WebAuthn and recovery

`ui_admin` and `ui_superadmin` accounts must enroll a passkey before receiving a full UI session. Any other user who voluntarily enrolls a passkey is challenged on subsequent logins as well. The RP ID and origin must exactly match `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN`; user verification is required, attestation is `none`, and challenges are single-use for five minutes.

After enrollment, ten recovery codes are displayed once. Store them outside the browser. Each code is hashed in the database and can be consumed once. Passkey changes, recovery-code regeneration, API-token management, external-identity revocation or decisions, and administrative session revocation require a WebAuthn-authenticated session from the last `MFA_RECENT_MINUTES` (15 minutes by default). Revoking an external identity invalidates every UI session and API token owned by that user.

Emergency recovery is restricted to the sole active superadmin:

```bash
cd backend
python -m app.scripts.reset_last_superadmin_mfa --email exact-admin@example.com
```

The command requires the exact typed confirmation, removes passkeys and recovery codes, increments `auth_version`, revokes every session and API token, and writes a secret-free audit event. The next login requires enrollment.

Create the first administrator interactively on an empty database:

```bash
cd backend
python -m app.scripts.create_first_admin --email exact-admin@example.com --full-name "Platform Admin"
```

Automatic admin seeding is disabled by default and forbidden in production.

## Federation

- OIDC always uses PKCE S256 and nonce. Discovery, authorization, token, JWKS, issuer, and optional UserInfo endpoints must be HTTPS and use an allowed host. ID tokens require a `kid`, an asymmetric signing key, an explicitly allowed algorithm (`RS256` by default), the configured issuer and audience, and `email_verified is true` before an email is used.
- LDAP production providers require LDAPS or StartTLS, certificate verification, modern TLS, escaped filters, and bounded timeouts.
- Email is never an automatic linking key. A collision creates an `external_identity_link_requests` row. A recently WebAuthn-verified superadmin must approve or reject it.

## API-token scopes

Every token contains and persists one or more exact scopes. Each domain supports `read` and `write`: `profile`, `admin`, `manager`, `browser`, `portal`, `ceph-admin`, and `storage-ops`. A read scope never authorizes a mutation. Routes without an explicit mapping reject API tokens by default.

Changing a user's password, email, role, activation, MFA, or external identity increments `users.auth_version` and immediately invalidates sessions and API tokens. Logout, global logout, refresh replay, explicit session revocation, and expiry are also database-enforced.

## Mandatory cutover procedure

Migrations `0107`–`0110` are a single compatibility boundary. Existing UI sessions, S3 sessions, refresh values, OIDC states, and API tokens do not survive. Migration `0109` erases S3 session secrets and has no data-restoring downgrade.

1. Stop the frontend, backend replicas, schedulers, and CronJobs.
2. Create and verify a restorable database backup. Keep the old credential-encryption key with it.
3. Before changing `CREDENTIAL_KEYS`, use the existing Admin key-rotation workflow to re-encrypt every persisted credential with a strong new primary key. Validate reads while the old key remains second in the ring, then retire it.
4. Generate distinct strong `UI_JWT_KEYS` and `API_JWT_KEYS`, plus strong credential and scheduler keys. Configure TLS, exact origins/hosts, WebAuthn, trusted proxy CIDRs, and registered S3 endpoints.
5. Set `BUCKETREEF_DB_BACKUP_VERIFIED=true` only for the verified migration run. Deploy backend, frontend, migrations, and configuration together.
6. Create the first superadmin interactively if the database has no users. Otherwise notify every user that reauthentication is required and every automation owner that API tokens must be recreated with explicit scopes.
7. Verify passkey enrollment/login, refresh rotation, session inventory/revocation, API scopes, OIDC/LDAP manual linking, S3 expiry, security headers, schedulers, and audit redaction.

If rollback is required after `0109`, stop all writers and restore the pre-deployment database and matching credential keys. Do not run Alembic downgrade through the cutover.

## Key rotation

- JWT rings verify every listed key and sign with the first. Add a new first UI key, wait beyond the maximum five-minute access-token lifetime, then remove the old UI key. Removing an API key invalidates API tokens signed by it; coordinate recreation or retain the previous key until their planned retirement.
- Credential rings decrypt with every listed key and encrypt with the first. Re-encrypt persisted credentials before removing an old key.
- Refresh values and recovery codes are opaque and hashed; rotate them through session renewal or regeneration, not by changing JWT keys.

## Related pages

- [Configuration](configuration.md)
- [Operations: API tokens](operations-api-tokens.md)
- [Backup and restore](backup-restore.md)
- [Production readiness](production-readiness.md)
- [Operations: security](operations-security.md)

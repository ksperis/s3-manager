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

Passkey enrollment is controlled by `AppSettings.general`: `require_passkey_for_admins` defaults to `true` for `ui_admin` and `ui_superadmin`, while `require_passkey_for_users` defaults to `false` for `ui_user` and `ui_none`. Direct S3 sessions are excluded. Any user who voluntarily enrolls a passkey is challenged on subsequent logins as well. Enabling a requirement takes effect at the next authentication and does not terminate existing sessions. The RP ID and origin must exactly match `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN`; user verification is required, attestation is `none`, and challenges are single-use for five minutes.

After enrollment, ten recovery codes are displayed once. Store them outside the browser. Each code is hashed in the database and can be consumed once. Admin revalidation follows a balanced action-based policy. Security inventories, link-request lists, authentication details, and API-token lists require an interactive Admin session but not recent WebAuthn. Defensive actions that only remove access—rejecting a link request, revoking a session, or revoking an API token—also use the active interactive session, while preserving authorization, confirmation, and audit controls.

When `require_passkey_for_admins` is enabled, access-creating or security-changing actions require WebAuthn verification from the last `MFA_RECENT_MINUTES` (15 minutes by default). These actions include approving an identity link, adding, revoking, or restoring an external identity, resetting MFA, setting a password, creating an API token or UI user, deleting a UI user, changing a user's identity, role, activation, privileges, Manager tools, or associations, changing authentication options or passkey requirements, and creating, updating, or deleting OIDC/LDAP providers. An unchanged normalized payload and a user full-name-only update do not require step-up. When the policy is disabled, these critical direct actions still require an authorized interactive Admin session but not recent WebAuthn. Personal security actions use a recent primary authentication when no passkey is enrolled or required; an enrolled or required passkey keeps the WebAuthn step-up. Revoking an external identity invalidates every UI session and API token owned by that user.

When that freshness window expires, a critical action offers an in-session
passkey verification without locking the surrounding page. The challenge is bound to the current
UI session; successful verification updates that session's `mfa_verified_at`
without issuing new access or refresh tokens, then retries the protected request
once. `MFA_RECENT_MINUTES` remains the backend source of truth, and recovery
codes do not satisfy this WebAuthn freshness requirement.

Emergency recovery is restricted to the sole active superadmin:

```bash
cd backend
python -m app.scripts.reset_last_superadmin_mfa --email exact-admin@example.com
```

The command requires the exact typed confirmation, removes passkeys, recovery codes, and pending challenges, increments `auth_version`, revokes every session and API token, and writes a secret-free audit event. The next login follows the current role policy. The sole active superadmin can be recovered only with this operator command.

Prefer an explicitly issued one-time web bootstrap on an empty database:

```bash
cd backend
python -m app.scripts.issue_first_admin_bootstrap
```

The 256-bit token expires after 15 minutes, is stored only as a SHA-256 digest,
travels in the URL fragment and then in `X-BucketReef-Bootstrap-Token`, and is
consumed atomically with creation of the sole first super-administrator. The
response sets a five-minute pre-authentication cookie and continues directly to
passkey enrollment.

Use the interactive CLI as an independent fallback:

```bash
cd backend
python -m app.scripts.create_first_admin --email exact-admin@example.com --full-name "Platform Admin"
```

No automatic or default administrator exists in any environment. Initial setup
closes permanently as soon as any user exists; recovery of an existing
administrator is a separate operator action.

## Federation

- OIDC always uses PKCE S256 and nonce. Discovery, authorization, token, JWKS, issuer, and optional UserInfo endpoints must be HTTPS and use an allowed host. ID tokens require a `kid`, an asymmetric signing key, an explicitly allowed algorithm (`RS256` by default), the configured issuer and audience, and `email_verified is true` before an email is used.
- LDAP production providers require LDAPS or StartTLS, certificate verification, modern TLS, escaped filters, and bounded timeouts.
- OIDC providers default to `linking_policy=manual`. In `trusted_email` mode, BucketReef links only a verified email in an exact configured domain to one active standard local-password account that has no active or revoked external identity. Privileged, inactive, already federated, unverified, out-of-domain, or unsafe matches remain manual. Unknown emails keep the existing JIT behavior and create a `ui_none` account.
- Admins decide requests only for standard users; Superadmins can also decide requests for privileged accounts. The immutable mapping key remains `(provider_type, provider_id, subject)`. Subjects are not written to audit metadata.
- Every new manual link request, and every request reopened after expiry, creates one warning in the notification center for each active administrator allowed to decide it. An unchanged pending request is not repeated; privileged targets notify Superadmins only.

The canonical administration routes are `/api/admin/identity/link-requests`, `/api/admin/identity/sessions`, and `/api/admin/users/{id}/security`. The former global routes under `/api/auth` are not aliases. Direct identity and critical security routes require a browser-backed UI session and reject Bearer tokens. No Bearer-token exception is exposed for direct identity or critical security mutations.

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

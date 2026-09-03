# API Reference

FastAPI exposes OpenAPI automatically.

Typical local endpoints:

- Swagger UI: `http://localhost:8000/docs`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

Use route-level schemas and examples in code as the canonical API contract.

## Main route groups

| Prefix | Audience | Notes |
|---|---|---|
| `/api/auth` | login/session | Local, OIDC, LDAP, cookie refresh, `/session`, session revocation, WebAuthn, recovery codes, external-identity approval, and scoped API tokens. |
| `/api/admin` | platform admins | Users, groups, endpoints, app settings, billing, audit, metrics, and key rotation. |
| `/api/manager` | account/context admins | Buckets, IAM, topics, usage stats, migrations, and Manager tools. |
| `/api/portal` | Portal users/managers | Storage Spaces, files, shares, access keys, usage, governance activity, provider access logs, and settings. |
| `/api/browser` | object operators | Bucket/object browsing for the selected execution context. |
| `/api/ceph-admin` | Ceph admins | Endpoint-scoped RGW Admin Ops workflows. |
| `/api/storage-ops` | storage operators | Cross-context operational bucket views and actions. |
| `/api/internal` | schedulers/automation | Cron-only endpoints protected by `INTERNAL_CRON_TOKEN`. |

## First-administrator bootstrap

- `GET /api/auth/bootstrap/first-admin/status` returns only whether an issued,
  unexpired token can currently be consumed.
- `POST /api/auth/bootstrap/first-admin` requires the exact trusted `Origin`
  and `X-BucketReef-Bootstrap-Token`. Its strict body contains `email`, optional
  `full_name`, `password`, and `password_confirmation`.
- Success returns the existing `AuthenticationResponse` with
  `mfa_enrollment_required` and a five-minute pre-authentication cookie.
- Missing, expired, invalid and consumed tokens share the same unavailable
  response. The token must never appear in a query string, request/audit log,
  response body or browser storage.

## Error contract

- `400` is returned when cookie and Bearer authentication are combined.
- `401` means the UI session or API token is missing, expired, or revoked.
- `403` means the authenticated identity lacks the route permission, CSRF/origin check, recent WebAuthn verification, or API-token scope.
- `404` may mean the resource does not exist or is intentionally hidden from the current scope.
- `409` is used for state conflicts or guarded destructive workflows.
- Storage-side denials preserve upstream semantics where possible, especially `AccessDenied`.

Do not infer storage permission from UI access. Native storage workflows still depend on the selected execution identity and S3/IAM decision.

## Authentication transport

UI authentication uses host-only cookies only. Login and refresh responses do
not contain an access token. `GET /api/auth/session` is the browser identity
contract, and mutating UI calls require both the exact configured `Origin` and
the session-bound `X-CSRF-Token`. Bearer authentication is reserved for scoped
API tokens; routes without an API-scope mapping reject it by default.

The security inventory is exposed through `/api/auth/sessions`,
`/api/auth/security/webauthn/credentials`, and
`/api/auth/security/external-identities`. Mutating personal security operations
require recent WebAuthn when a passkey is enrolled or required, and recent
primary authentication otherwise. Admins use `/api/admin/identity/sessions`
and `/api/admin/identity/link-requests` within their role hierarchy to revoke
sessions and decide manual federated-identity links. Reading these inventories,
reading user authentication details, listing API tokens, rejecting a link, and
revoking a session or token require an interactive Admin session without recent
WebAuthn. Approving a link or changing identity, authentication, credentials,
users, privileges, associations, or OIDC/LDAP providers requires recent
WebAuthn when the global Admin passkey policy is enabled. The backend compares
normalized persisted user and authentication-setting values before requiring
step-up, so unchanged payloads and full-name-only user updates remain free of
the prompt.

Direct identity routes reject Bearer tokens even when the Admin passkey policy
is disabled. No non-interactive identity-mutation exception is exposed.

`GET /api/admin/navigation/pending-requests` provides the lightweight Admin
navigation counters `identity_link_requests` and `portal_requests`. Identity
counts include only non-expired pending requests visible within the actor's
role hierarchy; Portal counts include only the exact `pending` status. The
aggregate exposes no request detail and does not require recent WebAuthn.

The personal notification center uses these endpoints:

- `GET /api/users/me/notifications` lists currently visible notifications.
- `DELETE /api/users/me/notifications/{notification_id}` removes one currently
  visible notification.
- `DELETE /api/users/me/notifications?read_only=true` removes all currently
  visible read notifications.

Both deletion routes return `{ deleted_count, unread_count }`; they never
delete another user's or a currently inaccessible notification. Notification
subjects include quota alerts, Identity Security requests, and endpoint health
transitions.

An authenticated UI user can renew recent WebAuthn verification without
creating a new session through
`POST /api/auth/security/webauthn/authentication/options` followed by
`POST /api/auth/security/webauthn/authentication/verify`. Both calls require the
normal trusted-origin and session-bound CSRF checks. The challenge is bound to
the current session, and the verify response contains the updated
`mfa_verified_at` timestamp.

## Audit and Portal access-log APIs

- `/api/admin/audit/logs` keeps the existing model and pagination contract but
  contains only control-plane and security events.
- `/api/portal/access-logs/page` and `/api/portal/access-logs/raw`
  expose provider Server Access Logging to Portal Managers. The page covers all
  S3 categories; there is no `mode` parameter.
- The page can filter by action, Storage Space, path, requester identity, and
  result. The former non-paginated `/api/portal/access-logs` route was removed.
- `/api/portal/transfers` and
  `/api/portal/transfers/server-access-logs*` were removed without aliases and
  return `404`.

Object operations are never inferred from the application audit API. Provider
logs may be delayed and are complete only when delivery and retention are
configured.

## Pagination and filters

List endpoints generally expose explicit filters in query parameters and return typed response models. Use the OpenAPI schema for the exact parameter names and response shape; use the frontend API modules as integration examples when a UI route already consumes the endpoint.

## Internal endpoints

Internal scheduler endpoints are not user APIs. They require the shared internal token and should stay behind trusted network controls.

`POST /api/internal/notifications/purge` deletes read and unread user
notifications older than `USER_NOTIFICATIONS_RETENTION_DAYS`, reports the
deleted row count, and is protected against concurrent runs by a database
operation lease. A retention value of `0` disables the purge.

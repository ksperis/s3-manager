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
`/api/auth/security/external-identities`. Mutating MFA and identity operations
require recent WebAuthn verification. Superadmins use `/api/auth/admin/sessions`
and `/api/auth/external-link-requests` to revoke sessions and decide manual
federated-identity links.

## Audit and Portal access-log APIs

- `/api/admin/audit/logs` keeps the existing model and pagination contract but
  contains only control-plane and security events.
- `/api/portal/access-logs`, `/api/portal/access-logs/page`, and
  `/api/portal/access-logs/raw` expose provider Server Access Logging to Portal
  Managers. List/page cover all S3 categories; there is no `mode` parameter.
- List/page can filter by action, Storage Space, path, requester identity, and
  result.
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

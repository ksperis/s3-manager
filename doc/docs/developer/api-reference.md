# API Reference

FastAPI exposes OpenAPI automatically.

Typical local endpoints:

- Swagger UI: `http://localhost:8000/docs`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

Use route-level schemas and examples in code as the canonical API contract.

## Main route groups

| Prefix | Audience | Notes |
|---|---|---|
| `/api/auth` | login/session | Local, OIDC, LDAP, refresh-session, and current-user flows. |
| `/api/admin` | platform admins | Users, groups, endpoints, app settings, billing, audit, metrics, and key rotation. |
| `/api/manager` | account/context admins | Buckets, IAM, topics, usage stats, migrations, and Manager tools. |
| `/api/portal` | Portal users/managers | Storage Spaces, files, shares, access keys, usage, activity, transfers, and settings. |
| `/api/browser` | object operators | Bucket/object browsing for the selected execution context. |
| `/api/ceph-admin` | Ceph admins | Endpoint-scoped RGW Admin Ops workflows. |
| `/api/storage-ops` | storage operators | Cross-context operational bucket views and actions. |
| `/api/internal` | schedulers/automation | Cron-only endpoints protected by `INTERNAL_CRON_TOKEN`. |

## Error contract

- `401` means the UI session or API token is missing or invalid.
- `403` means the authenticated UI identity cannot access the surface or action.
- `404` may mean the resource does not exist or is intentionally hidden from the current scope.
- `409` is used for state conflicts or guarded destructive workflows.
- Storage-side denials preserve upstream semantics where possible, especially `AccessDenied`.

Do not infer storage permission from UI access. Native storage workflows still depend on the selected execution identity and S3/IAM decision.

## Pagination and filters

List endpoints generally expose explicit filters in query parameters and return typed response models. Use the OpenAPI schema for the exact parameter names and response shape; use the frontend API modules as integration examples when a UI route already consumes the endpoint.

## Internal endpoints

Internal scheduler endpoints are not user APIs. They require the shared internal token and should stay behind trusted network controls.

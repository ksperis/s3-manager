# Architecture Overview

Kaelo uses a standard web-console architecture:

- **Frontend**: React + Vite UI.
- **Backend**: FastAPI API.
- **Data**: relational DB (SQLite default, migrations via Alembic).
- **Execution model**: backend resolves storage-side executor identity from UI context.

## Request flow

1. User authenticates to UI.
2. Frontend calls backend `/api` routes.
3. Backend checks role/surface constraints.
4. Backend resolves execution context/executor.
5. Backend calls storage APIs (S3, IAM, RGW Admin Ops when applicable).

## Audit architecture

Application `audit_logs` records control-plane, security, configuration, and
workflow-control events. S3 object activity belongs to the data plane and is
audited through provider Server Access Logging or an equivalent storage log.
See [Audit boundary](audit-boundary.md).

## Surface map

| Surface | Primary route | Backend authority |
|---|---|---|
| Admin | `/admin` | UI role and platform governance checks. |
| Manager | `/manager` | Selected execution context plus S3/IAM or managed workflow rules. |
| Portal | `/portal` | Portal account link, Storage Space metadata, collaborator grants, and projected IAM policies. |
| Browser | `/browser` | Selected Browser execution context and storage-side S3 permission. |
| Ceph Admin | `/ceph-admin` | Admin role, Ceph Admin entitlement, and endpoint-scoped RGW Admin Ops credential. |
| Storage Ops | `/storage-ops` | Storage Ops entitlement and explicit operational target scope. |

## Documentation contract

When a route or feature changes, update the matching user, ops, or developer page and then update [Docs maintenance](docs-maintenance.md). The route tree in `frontend/src/router.tsx` is the fastest way to check whether user-facing coverage is still current.

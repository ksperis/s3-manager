# Architecture: Backend

## Location

- Main entrypoint: `backend/app/main.py`
- Routers: `backend/app/routers/`
- Services: `backend/app/services/`

## Router groups

- Auth/users
- Admin
- Manager
- Portal
- Browser
- Ceph Admin
- Internal cron endpoints

## Feature gating

Router dependencies enforce global feature enablement (`require_*_enabled`).

## Error behavior

Backend preserves storage/API denial semantics and logs server-side details.

## API models

All application request and response DTOs inherit from
`app.models.base.ApiModel`. This boundary rejects unknown properties; do not
inherit directly from Pydantic's `BaseModel` for an application API schema.
FastAPI-generated form and multipart schemas are the only exceptions.

## Service boundaries

- Routers validate the HTTP boundary and call services.
- Services own business rules, storage execution choices, and audit metadata.
  The central audit policy rejects data-plane and operational-noise actions
  before persistence.
- Client modules wrap S3, IAM, RGW Admin Ops, or external integrations.
- Models and migrations define persistence; do not encode new authorization semantics only in the frontend.

## Operational routes

Internal cron routes are not UI routes. Keep them token-protected and documented
in Ops pages when scheduler behavior changes. Their health, billing, and usage
collection runs are operational telemetry rather than application audit rows.

See [Audit boundary](audit-boundary.md) before adding any audit producer.

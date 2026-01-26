
# Backend (FastAPI)

## Location

Backend sources live under `backend/`.

Entry point:

- `backend/app/main.py`

## Routers

Routers are organized by surface and feature area. Notable groups include:

- Auth and users: `app/routers/auth.py`, `app/routers/users.py`
- Admin: `app/routers/admin_*`
- Manager (account context): `app/routers/manager_*`
- Browser: `app/routers/browser.py` and related routers
- IAM: `app/routers/iam_*`
- Portal: `app/routers/portal.py` (conditionally enabled)

## Error handling

The backend adds custom exception handling to ensure that server errors are logged,
and it detects common S3 errors (e.g., AccessDenied) for appropriate logging behavior.

See `backend/app/main.py` exception handler for details.

## OpenAPI

FastAPI publishes OpenAPI automatically. Typical URLs:

- OpenAPI JSON: `/openapi.json`
- Swagger UI: `/docs`

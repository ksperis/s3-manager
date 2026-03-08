# Architecture Overview

s3-manager uses a standard web-console architecture:

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


# High-level architecture

s3-manager follows a standard web-console architecture:

- **Frontend**: React + Vite + Tailwind (directory: `frontend/`)
- **Backend**: FastAPI (directory: `backend/`)
- **Database**: SQLite by default, with Alembic migrations
- **Executors**: backend code that interacts with S3 and (when available) admin APIs

## Request flow

1. User authenticates to the UI (OIDC or local auth)
2. UI calls backend APIs under `/api`
3. Backend validates the UI identity and surface entitlements
4. Backend selects an executor (Account context or S3 Connection)
5. Backend calls:
   - S3 APIs (buckets, objects, lifecycle, IAM)
   - and optionally RGW admin APIs (Ceph-specific administration)

## Surfaces vs APIs

Backend routers are grouped by responsibilities and are conditionally enabled
(see `backend/app/main.py` and router dependencies).

This provides a clean mechanism to deploy only the surfaces you need.

# s3-manager

Full-stack web portal to manage S3-compatible environments (Ceph RGW, MinIO, others).
It combines a FastAPI backend and a React frontend for accounts, buckets, IAM, and objects.

## Overview
- 3 functional areas: Admin, Manager, Portal
- S3 object browser with presigned URLs (direct uploads/downloads)
- Authentication via email/password, S3 access keys, or OIDC
- Statistics, audit logs, quotas, and app settings

## Features by role
### Admin (super_admin)
- RGW accounts: create/import, quotas, storage
- UI users + S3 users management
- Storage endpoints + application settings
- Global statistics and audit logs

### Manager (account_admin)
- Buckets: create, versioning, locks, tags
- IAM: users, groups, roles, policies
- S3 object browser (versions, tags, multipart)
- Account-level stats and traffic

### Portal (ui_user)
- Usage dashboard
- Accessible buckets and details
- Access key management (per policy)

## Architecture
- `backend/` FastAPI, SQLAlchemy, boto3, JWT
- `frontend/` React, Vite, Tailwind
- `docs/browser.md` details of the object browser API

## Screenshots

![Admin dashboard](docs/screenshots/admin-dashboard.png)
![Manager buckets](docs/screenshots/manager-buckets.png)
![S3 browser](docs/screenshots/s3-browser.png)

## Quickstart

Prerequisites: Python 3.11+ (3.12 recommended), Node 18+.

### Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Admin credentials (SQLite seed): `admin@example.com` / `changeme`.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
UI: `http://localhost:5173` (default API: `http://localhost:8000/api`).
To override: create `frontend/.env` with `VITE_API_URL=http://.../api`.

## Configuration
Baseline config:
- `backend/.env.example` for API variables (S3/RGW, DB, CORS, OIDC, etc.)
- `frontend/.env.example` for Vite environment

Backend key variables:
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `RGW_ADMIN_ENDPOINT`, `RGW_ADMIN_ACCESS_KEY`, `RGW_ADMIN_SECRET_KEY`
- `DATABASE_URL`, `CORS_ORIGINS`, `SUPER_ADMIN_*`
- `OIDC_PROVIDERS__<id>__*` for SSO

## Useful scripts
RGW demo seeding (buckets, users, objects):
```bash
cd backend
python -m app.scripts.seed_demo_data --config app/scripts/demo_seed.yaml
```
Update RGW caps for existing accounts:
```bash
cd backend
python -m app.scripts.grant_account_caps
```

## Tests
```bash
cd backend
pytest
```
`backend/tests_ceph_functional` requires a configured Ceph RGW environment.

## Deployment
Dockerfiles are provided in `backend/` and `frontend/`.
The frontend is served via Nginx (`frontend/nginx.conf`).

## License
Apache-2.0. See `LICENSE`.

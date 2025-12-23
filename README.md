# s3-manager

Full-stack portal to manage S3/Ceph RGW resources.

## Structure
- `backend/` FastAPI API with JWT auth and S3 integration
- `frontend/` React + Vite + Tailwind admin/manager UI

## Getting started

### Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Default admin credentials for quickstart (SQLite auto-seed): `admin@example.com` / `changeme`.

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Access the UI at `http://localhost:5173`. The frontend defaults to `http://localhost:8000/api` for API calls; configure via `frontend/.env` with `VITE_API_URL`.

## Roles & routing

- **Admin (super_admin)** — global RGW admin ops:
  - API: `/api/admin/*` (`/admin/accounts`, `/admin/stats`, `/admin/users`, `/users/me`, `/auth/*`)
  - UI: `/admin/*` (dashboard, accounts, users)
- **Manager (account_admin)** — account-scoped IAM/S3:
  - API: `/api/manager/*` (`/manager/buckets`, `/manager/iam/policies`, `/manager/stats`)
  - UI: `/manager/*` (dashboard, buckets, IAM/policies placeholder)

JWT and user profile are stored in `localStorage` (`token`, `user`).

## TODO / Roadmap


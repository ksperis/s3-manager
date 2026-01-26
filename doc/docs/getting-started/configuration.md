
# Configuration

s3-manager configuration is split across:

- backend settings (FastAPI) in `backend/app/core/config.py`
- frontend settings via Vite env vars (example: `VITE_API_URL`)

## Backend settings

The backend reads settings from environment variables (see `backend/app/core/config.py`).

Common categories:

- API prefix (default: `/api`)
- authentication / identity provider configuration (OIDC, local auth, etc.)
- feature toggles (enabling/disabling surfaces like Portal or Browser)
- database configuration (SQLite by default)

## Frontend settings

The frontend expects the API URL at `http://localhost:8000/api` by default.
Override using a `.env` file (repository root) with:

```bash
VITE_API_URL=http://localhost:8000/api
```

## Feature toggles

Some surfaces are conditionally enabled by backend dependencies (see router dependencies in `backend/app/main.py`).
If a surface is disabled, related routes will not be included.

Use this to:

- deploy a **minimal credential-first console** (Browser surface only)
- deploy a **platform console** (Admin + Manager + optional Portal)

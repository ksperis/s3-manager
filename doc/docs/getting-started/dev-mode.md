
# Run locally (dev mode)

This section documents the typical developer workflow when running backend and frontend locally.

## Backend (FastAPI)

From `backend/`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend is served at:

- API base: `http://localhost:8000/api`
- OpenAPI UI: `http://localhost:8000/docs`

## Frontend (React + Vite)

From `frontend/`:

```bash
npm install
npm run dev
```

Configure the API URL via `VITE_API_URL` in a root `.env`:

```bash
VITE_API_URL=http://localhost:8000/api
```

See `frontend/README.md` for more notes about the shell layout and available pages.

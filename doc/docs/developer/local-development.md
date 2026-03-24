# Local Development

## VS Code Run and Debug

The repository includes a VS Code `Run and Debug` profile in
`/.vscode/launch.json`.

Available profiles:

- `Backend: FastAPI`: starts the API on `http://localhost:8000`
- `Frontend: Vite`: starts the UI on `http://localhost:5173`
- `Full stack: backend + frontend`: launches both together

The frontend dev server proxies `/api` to `http://localhost:8000`, so the
backend and frontend profiles work together without extra frontend changes.

## Prerequisites

Install dependencies first:

Backend, from `backend/`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Frontend, from `frontend/`:

```bash
npm install
```

The backend reads `backend/.env` when present. For a simple local setup, the
default SQLite configuration is sufficient.

## Equivalent terminal commands

If you prefer not to use VS Code launch profiles, the matching commands are:

Backend:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm run dev
```

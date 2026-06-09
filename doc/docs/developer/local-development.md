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

## Manual UI smoke test

For a quick browser check of a real development route, run the backend and
frontend with explicit loopback addresses and ports:

Backend, from `backend/`:

```bash
rtk .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend, from `frontend/`:

```bash
rtk npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/<route>`, for example
`http://127.0.0.1:5173/admin/storage-endpoints`. The Vite dev server proxies
relative `/api` requests to `http://localhost:8000` by default.

If the page redirects to `/login`, use the local bootstrap account when the
current database has it:

- email: `admin@example.com`
- password: `changeme`

If the local database already contains other users, use the known local account
instead of reseeding or resetting data unexpectedly.

When validating an interface change, check the route content and the browser
console. A successful `npm run dev`, type check, or unit test run does not prove
that the route renders correctly in the browser.

Other interface testing options:

- Use Vitest and Testing Library for component states, forms, and request
  payload assertions.
- Use `cd frontend && rtk npm run test:e2e` for repeatable `/browser` flows
  backed by the browser E2E Playwright config.
- Use `cd frontend && rtk npm run docs:screenshots` and then
  `rtk npm run docs:screenshots:check` for documentation screenshots and
  visual states.

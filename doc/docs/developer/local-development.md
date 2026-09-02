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

For a Docker-based check of the exact working tree, run `./quickstart` from the
repository root. It builds `docker-compose.build.yml`, so the first run can be
slower than the direct development servers but cannot silently test stale
published images.

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

AI agents that need repeatable authenticated Admin or Browser access should use
[Authenticated UI access for AI agents](authenticated-ui-ai-agents.md). The
commands below remain useful for a human-driven route check or a local instance
whose existing data is intentionally in scope.

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

If a fresh database redirects to `/login`, issue a one-time link from the
running backend:

```bash
cd backend
rtk .venv/bin/python -m app.scripts.issue_first_admin_bootstrap
```

Open the printed `/setup/first-admin#token=...` URL and enroll a passkey. The
Browser E2E harness uses the same web bootstrap with `E2E_ADMIN_*` variables.
If the database already contains users, sign in with a known local account; do
not reset or reseed unrelated development data.

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


# Frontend (React)

## Location

Frontend sources live under `frontend/`.

## Runtime assumptions

- Default API URL: `http://localhost:8000/api`
- Override via `VITE_API_URL` in a `.env` at repo root

## App shell

As described in `frontend/README.md`:

- topbar + sidebar console layout
- light/dark theme toggle (persisted in localStorage)
- consistent page headers and dense table styling for Admin/Manager areas

## Routes and surfaces

The frontend defines routes for multiple surfaces:

- `/admin/*`
- `/manager/*`
- `/browser/*`
- `/portal/*` (if enabled)

The exact route list may evolve; keep this documentation aligned with the router structure
and the UI navigation layout.

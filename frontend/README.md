# s3-manager Frontend (React + Vite + Tailwind)

## Quickstart

```bash
npm install
npm run dev
```

The app expects the API at `/api` by default. Override with `VITE_API_URL` in a `.env` file at the project root:

```
VITE_API_URL=http://localhost:8000/api

In Kubernetes, `/api` should be routed to the backend by the Ingress (or another reverse proxy).
```

## App shell / theme
- Topbar + sidebar "console" layout with light/dark toggle (persisted in `localStorage`).
- Breadcrumbs + `PageHeader`/cards for each view; tables use the same dense style for Admin/Manager.

## Available pages (high level)
- Auth: Login (password, RGW keys, or external OIDC providers such as Google) + Unauthorized page; OIDC callbacks handled under `/oidc/:provider/callback`.
- Admin area (`/admin/*`, role `ui_admin`):
  - Dashboard: real stats cards + accounts summary table.
  - Accounts: RGW admin ops (create/import accounts + quotas), users (CRUD) unchanged.
- Manager area (`/manager/*`, role `ui_user` or `ui_admin`):
  - Dashboard: account-scoped stats cards.
  - Buckets: list + delete + wizard de création multi-étapes (nom, versioning, block public access, Object Lock, tags), lien vers détail.
  - Bucket detail: onglets Overview / Objects (split view mock), Properties / Permissions / Metrics / Advanced (placeholders structurés).
  - IAM: Users/Groups/Roles/Policies pages exist, to be progressively refondus dans le nouveau shell.

## Default login redirect
- `ui_admin` -> `/admin`
- `ui_user` -> `/manager` by default
- `ui_user` with only portal rights (portal_user/portal_manager and no `account_admin` on any account) -> `/portal`
- `ui_none` or missing role -> `/unauthorized`

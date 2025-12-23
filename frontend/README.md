# s3-manager Frontend (React + Vite + Tailwind)

## Quickstart

```bash
npm install
npm run dev
```

The app expects the API at `http://localhost:8000/api` by default. Override with `VITE_API_URL` in a `.env` file at the project root:

```
VITE_API_URL=http://localhost:8000/api
```

## App shell / theme
- Topbar + sidebar "console" layout with light/dark toggle (persisted in `localStorage`).
- Breadcrumbs + `PageHeader`/cards for each view; tables use the same dense style for Admin/Manager.

## Available pages (high level)
- Auth: Login (password, RGW keys, or external OIDC providers such as Google) + Unauthorized page; OIDC callbacks handled under `/oidc/:provider/callback`.
- Admin area (`/admin/*`, role `super_admin`):
  - Dashboard: real stats cards + accounts summary table.
  - Accounts: RGW admin ops (create/import accounts + quotas), users (CRUD) unchanged.
- Manager area (`/manager/*`, role `account_admin` or `super_admin`):
  - Dashboard: account-scoped stats cards.
  - Buckets: list + delete + wizard de création multi-étapes (nom, versioning, block public access, Object Lock, tags), lien vers détail.
  - Bucket detail: onglets Overview / Objects (split view mock), Properties / Permissions / Metrics / Advanced (placeholders structurés).
  - IAM: Users/Groups/Roles/Policies pages exist, to be progressively refondus dans le nouveau shell.

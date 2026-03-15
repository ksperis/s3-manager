# s3-manager Frontend (React + Vite + Tailwind)

## Quickstart

```bash
npm install
npm run dev
```

The app expects the API at `/api` by default. In dev, Vite will proxy `/api` to `VITE_API_PROXY_TARGET` (defaults to `http://localhost:8000`).
Override with `VITE_API_URL` in a `.env` file at the project root:

```bash
VITE_API_URL=/api
VITE_API_PROXY_TARGET=http://localhost:8000
```

In Kubernetes, `/api` should be routed to the backend by the Ingress (or another reverse proxy).

## UI Quality Gates

Run the complete frontend quality pipeline:

```bash
npm run check
```

This executes:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run budget:check`

Current gate scope is intentionally incremental on the UI audit perimeter (Topbar, Modal, account selectors, auth entrypoints, route lazy loading helpers, and shared test setup). This avoids blocking on unrelated legacy debt while still preventing regressions in the audited surfaces.

### Bundle baseline

Baseline captured before route-level lazy loading refactor (2026-02-28):

- Entry/primary runtime bundle reached ~2.65 MB minified (`dist/assets/index-CeF-w1y-.js`).
- Build emitted chunk-size warnings.

Post-refactor validation is enforced by `scripts/check-bundle-budget.mjs` using Vite manifest data.

Post-refactor measurements (2026-02-28):

- Entry chunk: `76.2 KB` (`assets/index-BTKkG_9K.js`)
- Largest chunk: `337.9 KB` (`assets/vendor-B9RtXmmQ.js`)
- Total JavaScript: `2.57 MB` across `114` chunks

### UI review checklist

- Dialogs:
  `role="dialog"`, `aria-modal`, keyboard `Escape`, focus trap, and focus return on close.
- Menus/listboxes:
  correct ARIA roles, `aria-controls`, predictable keyboard navigation (`Arrow*`, `Home/End`, `Enter`, `Escape`, `Tab`).
- Responsive behavior:
  no topbar overflow on mobile; browser side panels disabled automatically on narrow viewports.
- Performance:
  route-level lazy loading preserved and bundle budget passing.

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
- `ui_none` or missing role -> `/unauthorized`

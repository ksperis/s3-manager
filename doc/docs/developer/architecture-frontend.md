# Architecture: Frontend

## Location

- `frontend/src/`
- Router: `frontend/src/router.tsx`

## App structure

- Workspace layouts (`Admin`, `Manager`, `Browser`, `Ceph Admin`, `Storage Ops`).
- Shared components for layout, topbar controls, and tables.
- Feature pages under `frontend/src/features/`.

## Runtime assumptions

- API root typically `/api`.
- Workspace visibility depends on role, entitlements, and backend settings.

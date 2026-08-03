# Architecture: Frontend

## Location

- `frontend/src/`
- Router: `frontend/src/router.tsx`

## App structure

- Workspace layouts (`Admin`, `Manager`, `Portal`, `Browser`, `Ceph Admin`, `Storage Ops`).
- Shared components for layout, topbar controls, and tables.
- Feature pages under `frontend/src/features/`.

## Runtime assumptions

- API root typically `/api`.
- Workspace visibility depends on role, entitlements, and backend settings.

## Internal contracts

- Keep route declarations in `frontend/src/router.tsx` and guard internals in
  `frontend/src/routerGuards.tsx`. Public paths are covered by
  `frontend/src/router.routeSnapshot.test.ts`; update the snapshot only for
  intentional route-contract changes.
- Keep UI gates executable in focused router and guard tests. UI gates describe
  surface access and affordances only; S3/IAM/backend enforcement remains the
  storage permission authority. Do not maintain a parallel manual access
  matrix that can drift from the router.
- Keep persistent browser keys in `frontend/src/utils/clientStorage.ts`.
  Feature code should use the helpers there instead of ad hoc JSON parsing.
- Cover API transport, context, and error behavior in focused client tests.
  Cover mutation loading, feedback, confirmation, and failure behavior in the
  corresponding feature tests instead of maintaining a parallel inventory.
- Keep surface vocabulary and route ownership in focused contracts such as
  `frontend/src/features/shared/bucketOpsSurface.ts`,
  `frontend/src/features/manager/bucketDetail/bucketDetailSurface.ts`,
  `frontend/src/features/admin/adminBreadcrumbs.ts`, and
  `frontend/src/features/portal/portalBreadcrumbs.ts`.

## Overlay close guard

Editable modals, drawers, and overlay panels must protect unapplied saveable
changes on every close path: header close, internal cancel/close buttons,
Escape, and backdrop clicks.

- Use `useUnsavedChangesGuard` with the standard copy:
  `Discard changes?`, `You have unapplied changes. Closing this dialog will discard them.`,
  `Keep editing`, and `Discard changes`.
- Compute dirty state from saveable payload fields only: forms, selected items
  to submit, JSON/policy text, quotas, credentials, and action options.
- Do not include view-only state such as active tabs, internal search filters,
  expanded panels, loading flags, statuses, or validation errors.
- Use `stableSignature` for snapshot comparisons when object key order, tag
  order, or selected ID order should not matter.
- After a successful submit/apply, reset the dirty snapshot or close through
  the raw success path so the confirmation is not shown for applied changes.
- Destructive confirmations and informational/progress/result dialogs should
  stay explicit and do not need this guard unless they also contain editable,
  unapplied values.

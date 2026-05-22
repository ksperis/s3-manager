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

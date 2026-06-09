# UI Theme Guidelines

The frontend theme is anchored by the shared shell and UI tokens in
`frontend/src/index.css`, plus reusable class exports in
`frontend/src/components/ui/styles.ts`.

## Tokens

- Use `shell-*` tokens only for the app shell, topbar, sidebar, and their
  controls.
- Use `ui-*` tokens for workspace content, cards, panels, forms, tables,
  dialogs, toolbars, and inline states.
- Prefer `--ui-surface`, `--ui-surface-muted`, `--ui-border`,
  `--ui-border-soft`, `--ui-text`, `--ui-text-muted`, `--ui-hover`,
  `--ui-selected-bg`, `--ui-focus-ring`, and `--ui-shadow-soft` over local
  Tailwind color chains.

## Primitives

- Cards and panels: start with `ui-surface-card`, `ui-surface-muted`,
  `uiCardClass`, `uiCardMutedClass`, `uiPanelClass`, or
  `uiPanelMutedClass`.
- Tables: use `ui-data-table`, `uiDataTableClass`, and
  `uiTableContainerClass` before adding page-specific table classes.
- Toolbars and filters: use `ListToolbar`, `PageControlStrip`,
  `uiToolbarClass`, `uiToolbarSecondaryClass`, shared compact toolbar classes,
  and `ActiveFiltersBar`.
- Buttons: use `UiButton`, `uiButtonBaseClass`, `uiButtonVariants`, or
  `uiIconButtonClass`; keep custom button chains for exceptional states only.
- Forms: use `ui-control`, `uiInputClass`, `uiLabelClass`, and
  `uiCheckboxClass`.
- Modals and menus: use `Modal`, `uiMenuClass`, `uiMenuItemClass`, shell menu
  classes in the topbar, and `AnchoredPortalMenu` for positioned menus.

## Patterns To Avoid

- Do not add workspace-scoped themes when a shared token or primitive fits.
- Avoid `bg-gradient-*`, `backdrop-blur`, `shadow-xl`, `shadow-2xl`,
  `rounded-xl`, and `rounded-2xl` on standard workspace surfaces.
- Keep strong shadows, translucent overlays, and larger radii for justified
  cases: authentication screens, popovers, overlays, alerts, badges, pills, and
  temporary operation states.
- Do not use visual refactors to change backend contracts, permissions, IAM/S3
  semantics, routes, or execution context behavior.

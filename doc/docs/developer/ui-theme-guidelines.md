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

## Documentation Theme

The published MkDocs theme should feel like the application shell and workspace
surfaces, not like a separate marketing site.

- `doc/docs/assets/stylesheets/docs-theme.css` mirrors the app tokens from
  `frontend/src/index.css`. Keep the same `--ui-*` and `--shell-*` token names
  when changing documentation colors, borders, text, shadows, or active states.
- Documentation content surfaces should follow app workspace primitives:
  8px radius (`0.5rem`), `--ui-surface`, `--ui-surface-muted`,
  `--ui-border`, `--ui-border-soft`, `--ui-text`, `--ui-text-muted`,
  `--ui-hover`, `--ui-selected-bg`, and soft/no shadows.
- Documentation density should also follow the app workspace posture: compact
  headings, tight vertical rhythm, dense tables, compact primary navigation,
  compact table of contents, and screenshot chrome that leaves as much room as
  possible for the actual capture.
- Documentation chrome should follow app shell primitives:
  `--shell-topbar-bg`, `--shell-sidebar-bg`, `--shell-border`,
  `--shell-text`, `--shell-muted`, `--shell-hover`, and
  `--shell-selected-bg`.
- Do not introduce one-off documentation palettes such as separate blue,
  purple, teal, or gradient systems. If the app primary color changes, update
  the mirrored docs token scale in the same pass.
- Validate meaningful documentation theme changes with a strict MkDocs build,
  the screenshot reference check, and at least one desktop/mobile render smoke
  of a table-heavy docs page.

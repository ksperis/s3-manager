# Changelog

## 0.1.8 - 2026-06-16

### Added

- Added Portal user access key management, storage-space browser access by default, dashboard usage signals, manager-aligned KPIs, and a complete usage analytics page.
- Added privileged target grants for Ceph actions, including admin configuration support and restored Storage Ops privileged bucket quota management.
- Added Manager feature-rule inventory, bucket-tag inventory, listing summaries, audit detail filters, and head-only bucket integrity checks.
- Added bucket usage analytics and deterministic bucket comparison output.

### Changed

- Organized usage metrics pages into tabs and shared more frontend table sorting, UI access modal, theme, and browser operations layout behavior.
- Refined Portal and Manager dashboard visuals, bucket quick filters, advanced-filter panels, and UI group association summaries.
- Kept Manager bucket quota mutation out of the Manager surface while preserving privileged quota workflows through Storage Ops.

### Fixed/Security

- Hardened backend token verification, redacted feature-inventory failures, and purged dependent operational data when deleting resources.
- Fixed Portal dark theme text colors, Portal top storage-space limits, browser queued-work panel state, browser operations action labels, and bucket column reset behavior.
- Fixed Manager dashboard data type chart color alignment, activity and incident card layout, and quiet handling of data type failures.
- Allowed UI admins to configure target grants and removed the inactive global search button.

### Performance

- Reduced duplicate Ceph Admin bucket-listing RGW calls with shared in-flight/cache reuse.

### Docs/Tests

- Documented Browser disablement options and updated release Helm examples for `0.1.8`.
- Stabilized local test suites, added Portal storage-space naming-mode coverage, prepared Ceph logging target policy setup, and aligned Ceph usage stats functional route coverage.

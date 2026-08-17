# Changelog

## 0.2.0 - 2026-08-17

### Added

- Added a dedicated Kaelo upgrade runbook covering backups, key preservation, storage identities, Portal logs, Compose data, and Helm releases.
- Added CI naming enforcement for tracked paths and contents, with documented exemptions for the upgrade mapping and historical audit evidence.
- Added Helm lint and template validation to the CI test stage.

### Changed

- Adopted `Kaelo - S3-compatible object storage management` across the UI, API metadata, documentation, packages, repositories, images, Compose, and Helm contracts.
- Renamed JWT, browser coordination, scheduler, temporary-file, policy SID, Ceph, IAM, and S3 identifiers to the Kaelo namespaces.
- Regenerated the 72 active documentation captures and moved the public documentation links to the Kaelo GitHub Pages path.

### Breaking changes

- Existing UI sessions and API tokens are invalid because the JWT issuer and audiences changed; users must sign in again and API tokens must be reissued.
- Deployments must migrate to `KAELO_*` variables, Kaelo image and chart names, and `klo-*` managed storage identities without runtime compatibility aliases.
- Compose deployments must migrate persisted data into the explicit `kaelo` project, while Helm deployments require a new `kaelo` release with restored or reattached data and secrets.

### Tests

- Passed the complete backend and frontend suites, production build, package budgets, Compose rendering, naming audit, screenshot generation, visual workspace checks, and strict documentation build.

## 0.1.11 - 2026-07-26

### Added

- Added anonymous LDAP directory searches with optional bind credentials and compatibility support for legacy TLS servers.
- Added unified Admin workflows for associating users, accounts, connections, and S3 identities.
- Added a consolidated Portal history experience combining activity and transfer records.

### Changed

- Standardized page layouts, breadcrumbs, tabs, list actions, and identity editing workflows across Admin, Portal, and Browser workspaces.
- Refined Portal Storage Space indicators, traffic labels, and navigation while keeping technical identifiers available where useful.
- Protected environment-managed storage endpoint credentials from database-only key rotation.

### Fixed/Security

- Filtered workspaces using effective access so inherited authorization is honored without exposing unauthorized workspaces.
- Propagated path-style endpoint configuration to Cyberduck bookmarks and improved compatibility with legacy LDAP TLS servers.
- Preserved initial bucket pagination and stabilized asynchronous identity listings, endpoint summaries, and related frontend interactions.

### Tests

- Expanded frontend coverage for S3 identity workflows, effective workspace access, bucket pagination, and asynchronous Admin listings.
- Stabilized CI-facing frontend validation for delayed API responses and persisted pagination state.

## 0.1.10 - 2026-07-22

### Added

- Added Portal collaboration workflows for reviewed access requests, external IAM credentials, public links, server access logging, history cleanup, and permanent Storage Space deletion.
- Added Ceph Admin operations with unified long-running bucket actions, richer endpoint health information, and routed bucket detail navigation.
- Added multi-backend coordination, identity avatars, quota notifications, and more explicit storage health signals.

### Changed

- Made Portal Storage Space metadata and grants authoritative, with private ownership, Viewer/Editor team grants, and consistent project-manager access.
- Standardized frontend tables, forms, filters, feedback, profile settings, navigation, and responsive behavior across the application workspaces.
- Hardened storage endpoint handling and long-running operation behavior while simplifying backend compatibility paths and shared service boundaries.

### Fixed/Security

- Restricted Portal access history to managers and refined external access, member request, and public-link cleanup behavior.
- Restored Manager bucket metrics access and improved resilience when storage endpoints or asynchronous UI data are temporarily unavailable.
- Kept Ceph functional test failures visible but advisory so intermittent lab failures no longer block immutable image builds.

### Breaking changes

- Migration `0066_portal_storage_space_access_model` removes legacy Portal Storage Space database and IAM state. Existing spaces must be recreated or re-imported after upgrading.

### Tests

- Expanded backend, frontend, migration, multi-backend, Portal, Storage Ops, and Ceph Admin coverage, including functional Ceph lifecycle scenarios.
- Stabilized asynchronous frontend and Ceph-dependent validation while retaining JUnit reports and CI artifacts for advisory Ceph failures.

## 0.1.9 - 2026-06-26

### Added

- Added UI group editing on storage targets and surfaced UI group access in storage listings.
- Added bucket purge workflows for Manager, Storage Ops, and Ceph Admin with streamed progress and audit-aware backend services.
- Added Browser workspace sidebar, folder navigation helpers, route/access matrices, and profile/runtime diagnostics coverage.

### Changed

- Refactored Browser, Portal, bucket migration, router dependencies, and shared frontend primitives into smaller service and UI modules.
- Refined Portal and Manager workspace UX, dashboards, KPI wrapping, breadcrumb behavior, and localized Portal copy.
- Updated user and operations documentation, screenshot assets, feature availability pages, and safe destructive operation guidance.

### Fixed/Security

- Restored core workspace kill switches after the settings refactor and hardened sensitive runtime error redaction.
- Improved Manager bucket deletion and purge-delete labeling while keeping empty-bucket deletion on the standard confirmation path.
- Softened Browser listing access errors and kept folder tools available behind the intended advanced-mode gates.

### Tests

- Added backend and frontend coverage for purge routes/services, dependency facades, Portal mappers, workspace routing, shared UI controls, and CI stability.
- Stabilized Ceph Admin quota persistence, frontend interaction tests, and login page theme-provider coverage.

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

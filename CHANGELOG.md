# Changelog

## 0.2.2 - 2026-09-02

### Added

- Added an Admin Identity Security workspace for policy management, user-factor administration, active-session visibility, and guided last-passkey recovery.
- Added a global control for managed private S3 provisioning and an authenticated Admin/Browser harness for repeatable agent UI smoke tests.
- Added canonical full-name identity listings, richer session-type summaries, and primary-action navigation from shared data-table rows.

### Changed

- Split account access into independent Manager administrator and Portal roles across direct and group associations, execution contexts, automations, and Portal IAM synchronization.
- Hardened Compose and Helm workloads with fixed non-root identities, read-only root filesystems, a dedicated scheduler image, explicit resources, and fail-closed NetworkPolicies.
- Consolidated Portal models, bucket listings and comparisons, RGW parsing, Admin associations, streaming APIs, and shared frontend state into narrower reusable contracts.

### Fixed/Security

- Required explicit trusted-proxy CIDRs in production and prevented untrusted forwarded addresses from selecting rate-limit identities.
- Restricted user-controlled S3 endpoints and migration webhooks to configured host allowlists, sanitized external error logging, and prevented API tokens from exporting temporary STS credentials.
- Made bucket UI-tag cleanup transactional, made partial SQLite role migration recoverable, and stabilized Ceph listings, Browser selection, Manager row navigation, modal sizing, and table action columns.

### Breaking changes

- Migration `0122_split_account_access_roles` replaces association `role` and root flags with `manager_role` and `portal_role`. Deploy the migration, backend, frontend, and automation clients together; legacy role fields are rejected.
- Rootless images use fixed identities, the frontend container listens on port `8080`, and existing root-owned backend volume files may require a one-time ownership migration to UID/GID `10001:10001` after backup.
- Helm's strict NetworkPolicy profile now requires ingress/DNS selectors, explicit egress rules, and `backend.trustedProxyCidrs`; production startup rejects an empty trusted-proxy boundary.
- Production user-supplied S3 endpoints and migration webhooks now fail closed unless their hosts are covered by `USER_SUPPLIED_S3_ENDPOINT_ALLOWED_HOSTS` and `BUCKET_MIGRATION_WEBHOOK_ALLOWED_HOSTS`.

### Tests

- Expanded backend, frontend, migration, deployment-security, Helm, Compose, authenticated browser, and contract coverage for the new identity and access model.
- Retained CI validation for project naming, vulnerability and secret scans, immutable SHA images, rootless runtime smoke tests, and the advisory Ceph functional suite.

## 0.2.1 - 2026-08-28

### Added

- Added a secure first-administrator bootstrap flow with a short-lived setup URL, passkey enrollment, and a console-only fallback.
- Added persistent, scalable bucket UI tags with shared settings, accessible colors, visibility controls, bulk workflows, and listing integration across Ceph Admin and Storage Ops.
- Added in-session WebAuthn step-up and a Portal external-links tab for Storage Spaces.

### Changed

- Unified BucketReef branding, responsive density, bucket workbench filters, bulk actions, selection, navigation, and configuration workflows across the frontend.
- Canonicalized Storage Endpoint features, providers, URLs, and admin overrides through migrations `0115` to `0118`.
- Made Admin S3 connection credentials, user links, and remediation updates atomic through the canonical update contract.
- Consolidated backend routers, services, execution contexts, listings, Portal orchestration, migrations, and audit boundaries to remove duplicated runtime paths.

### Fixed/Security

- Ensured object previews always open, public links include their domain, and WebAuthn profile challenges are classified consistently.
- Improved fresh-database bootstrap and bucket UI tag performance while preserving scoped cleanup and assignment isolation.
- Hardened first-admin creation, private connection deletion, IAM removals, bucket configuration removal, and destructive migration confirmations.

### Breaking changes

- Removed automatic `SEED_SUPER_ADMIN_*` startup seeding. New deployments must issue a one-time bootstrap URL or use the first-admin CLI.
- Storage Endpoint inputs must use canonical `features` and `healthcheck_url` fields; `admin_endpoint` is removed, and migration `0118` rejects empty or canonically colliding URLs.
- Removed dedicated Admin S3 connection credentials, user-link, and remediation routes. Clients must send `credentials`, `user_ids`, and `remediation_action` through the canonical update endpoint.
- Bucket UI tag definition names are globally unique case-insensitively; catalogue responses no longer embed assignments, and orphan-inventory routes are removed.
- Execution-context catalogues no longer expose the unused quota and entity-limit fields.

### Tests

- Expanded backend, frontend, migration, OpenAPI, audit, accessibility, browser E2E, quickstart, Helm, Kind, Compose, and strict documentation validation.
- Stabilized asynchronous frontend actions and CI startup for PostgreSQL, Ceph, and Docker-in-Docker Kind validation.

## 0.2.0 - 2026-08-19

### Added

- Added a dedicated BucketReef upgrade runbook covering backups, key preservation, storage identities, Portal logs, Compose data, and Helm releases.
- Added CI naming enforcement for tracked paths and contents, with documented exemptions for the upgrade mapping and historical audit evidence.
- Added Helm lint and template validation to the CI test stage.

### Changed

- Adopted `BucketReef - S3-compatible object storage management` across the UI, API metadata, documentation, packages, repositories, images, Compose, and Helm contracts.
- Replaced the withdrawn pre-release branding and artifacts before republishing `v0.2.0`.
- Renamed JWT, browser coordination, scheduler, temporary-file, policy SID, Ceph, IAM, and S3 identifiers to the BucketReef namespaces.
- Regenerated the 72 active documentation captures and moved the public documentation links to the BucketReef GitHub Pages path.

### Breaking changes

- Existing UI sessions and API tokens are invalid because the JWT issuer and audiences changed; users must sign in again and API tokens must be reissued.
- Deployments must migrate to `BUCKETREEF_*` variables, BucketReef image and chart names, and `bkr-*` managed storage identities without runtime compatibility aliases.
- Compose deployments must migrate persisted data into the explicit `bucketreef` project, while Helm deployments require a new `bucketreef` release with restored or reattached data and secrets.

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

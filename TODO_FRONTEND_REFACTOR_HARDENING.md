# Frontend Refactor And Hardening TODO

This file tracks the incremental cleanup, hardening, and refactor work for the
frontend. It mirrors the backend hardening objective: improve readability,
security posture, maintainability, and validation coverage without intentional
changes to public routes, backend API contracts, feature gates, workspace
semantics, or access rules.

The work must stay incremental. Each lot should be small enough to review,
validate, and revert independently.

## Baseline Inventory

Generated on 2026-06-25 with:

```bash
cd /Users/laurent/ksperis/s3-manager/frontend
rtk npm run refactor:inventory
```

- Frontend code files under `frontend`, excluding `node_modules`, `dist`, and
  `coverage`: 468
- Frontend code lines under `frontend`: 152428
- TypeScript and React files under `frontend/src`: 441
- Lines under `frontend/src`: 146946
- Largest `frontend/src` areas:
  - `features/browser`: 43 files, 29818 lines
  - `features/manager`: 66 files, 26583 lines
  - `features/admin`: 49 files, 25355 lines
  - `features/shared`: 38 files, 20510 lines
  - `features/cephAdmin`: 27 files, 11629 lines
  - `components`: 97 files, 12074 lines
  - `api`: 54 files, 9586 lines
  - `features/portal`: 28 files, 6847 lines
- Largest files:
  - `src/features/browser/BrowserPage.tsx`: 15492 lines
  - `src/features/shared/BucketOpsWorkbench.tsx`: 11011 lines
  - `src/features/manager/BucketDetailPage.tsx`: 4830 lines
  - `src/features/browser/BrowserPage.interactions.test.tsx`: 4763 lines
  - `src/features/admin/UsersPage.tsx`: 2456 lines
  - `src/features/admin/AccountsPage.tsx`: 2324 lines
  - `src/features/shared/ProfilePage.tsx`: 2061 lines
  - `src/features/admin/StorageEndpointsPage.tsx`: 1970 lines
  - `src/features/browser/BrowserObjectDetailsModal.tsx`: 1947 lines
  - `src/features/manager/ManagerBucketCompareModal.tsx`: 1770 lines
- Hardening/refactor signals:
  - `localStorage`: 298 occurrences in 73 files
  - `sessionStorage`: 5 occurrences in 3 files
  - `catch (`: 339 occurrences in 81 files
  - `error.message`: 18 occurrences in 10 files
  - `String(error)`: 1 occurrence in 1 file
  - `console.`: 108 occurrences in 36 files
  - `dangerouslySetInnerHTML`: 0 occurrences
  - `TODO`: 0 occurrences
  - `FIXME`: 0 occurrences
- Route surface counts:
  - `manager`: 23 routed paths
  - `admin`: 20 routed paths
  - `portal`: 10 routed paths
  - `ceph-admin`: 7 routed paths
  - `shared`: 5 routed paths
  - `storage-ops`: 2 routed paths
  - `browser`: 1 routed path

## Guiding Constraints

- Preserve the route contract exposed by `frontend/src/router.tsx` for
  `/admin`, `/manager`, `/portal`, `/browser`, `/ceph-admin`, `/storage-ops`,
  `/profile`, `/login`, `/oidc/:provider/callback`, and `/unauthorized`.
- Do not change backend routes, payload shapes, status handling, feature flags,
  account-context rules, or execution-context semantics from frontend refactors.
- Do not introduce a parallel permission model. UI gates only control surfaces,
  chrome, and affordances; IAM and S3 remain the source of storage permission.
- Keep S3 Account and S3 Connection concepts distinct in labels, state, route
  guards, API clients, and component props.
- Preserve Portal as an end-user workspace. Keep Portal labels user-oriented and
  avoid Manager, Browser, Ceph Admin, IAM, ARN, policy JSON, or bucket diagnostic
  vocabulary unless a dedicated product task explicitly changes that contract.
- Preserve Browser profiles and embedded Browser restrictions for Manager,
  Portal, and Ceph Admin. Do not add `/portal/browser`.
- Use the shared UI primitives and theme tokens documented in:
  - `doc/docs/developer/product-design-guidelines.md`
  - `doc/docs/developer/workspace-surface-separation.md`
  - `doc/docs/developer/ui-theme-guidelines.md`
- Keep runtime feedback useful while avoiding leaked implementation details,
  credentials, access keys, tokens, presigned URLs, or upstream stack details in
  visible UI errors.
- For real route behavior, validate with browser-level smoke when rendering,
  navigation, feature gates, or route state matter.

## Route And Surface Hotspots

The router currently centralizes route guards, lazy imports, workspace access,
and feature checks in `frontend/src/router.tsx`.

- `/admin`: platform governance, users, groups, accounts, connections,
  endpoints, audit, metrics, billing, settings, usage history, and key rotation.
- `/manager`: S3/IAM configuration, buckets, users, groups, roles, policies,
  topics, Ceph keys, bucket tools, feature rules, migrations, metrics, and the
  optional embedded Manager Browser.
- `/browser`: advanced standalone object explorer with selected execution
  context.
- `/portal`: end-user Storage Spaces, object detail, access keys, shares,
  activity, transfers, usage, and personal settings.
- `/ceph-admin`: Ceph RGW operator workflows, accounts, users, buckets, metrics,
  and optional endpoint-wide embedded Browser.
- `/storage-ops`: operational bucket tooling and cross-account maintenance.

Manual review should prioritize route guards around Portal access, Browser
surface enablement, Ceph Admin feature enablement, Storage Ops access, Manager
tool gates, and admin-only settings.

## Incremental Work Items

| ID | Status | Risk | Area | Target | Validation |
| --- | --- | --- | --- | --- | --- |
| FE-HARD-001 | Done | Low | Inventory | Add a reproducible frontend inventory command or script for file counts, largest modules, route surfaces, storage usage, catch/error display signals, and route guards. Keep this file updated with the output. | `rtk npm run refactor:inventory`, `rtk git diff --check`. |
| FE-HARD-002 | Done | Medium | Error handling | Audit visible UI error extraction and display paths, especially `src/utils/apiError.ts`, `src/utils/routeError.ts`, SSE helpers, migrations, Browser, Portal, Manager IAM, Ceph Admin, and shared bucket tools. Redact secrets, tokens, access keys, presigned URLs, internal URLs, and unexpected upstream details. | Redaction tests, targeted stream tests, full Vitest suite, typecheck. |
| FE-HARD-003 | Done | Medium | Runtime logging | Classify `console.*` usage into expected developer diagnostics, route-level failure reporting, test-only output, and removable noise. Remove or normalize noisy production logs without hiding actionable user feedback. | Runtime diagnostics tests, `rtk npm run lint:browser`, full Vitest suite. |
| FE-HARD-004 | Done | Medium | Browser/SSE state | Harden stream and long-running operation feedback for Browser, bucket tools, migrations, storage ops, and Ceph Admin. Unexpected failures should produce generic UI messages while retaining stable progress state and retry behavior. | Targeted SSE tests, Browser lint, full Vitest suite. |
| FE-ACCESS-001 | Todo | High | Route guards | Extract route guard logic from `router.tsx` into focused internal modules for auth/session, workspace resolution, feature flags, Browser surfaces, Portal access, Manager tool gates, Ceph Admin, and Storage Ops. Keep `router.tsx` as the route declaration facade. | Route tests for Admin, Manager, Portal, Browser, Ceph Admin, and Storage Ops access. |
| FE-ACCESS-002 | Todo | High | UI gates | Build a matrix of feature flags, UI role gates, connection access flags, and Browser profiles. Confirm that hidden or disabled controls never claim to enforce storage authorization. | Static matrix plus router/component tests for each surface. |
| FE-STORAGE-001 | Todo | Medium | Client storage | Centralize local/session storage keys for token, user, selected workspace, execution context, Portal account, Ceph Admin endpoint, Browser UI state, branding, theme, and selector preferences. Add parse guards and migration helpers for legacy keys. | Unit tests for storage adapters and legacy-key fallback behavior. |
| FE-API-001 | Todo | Medium | API clients | Review `frontend/src/api` for duplicated axios handling, scattered header construction, ad hoc response mapping, and raw error extraction. Keep API clients thin and typed, with targeted mappers between backend payloads and UI view models. | API client tests and typecheck. |
| FE-API-002 | Todo | Medium | Mutation flows | Inventory frontend mutating actions and confirm each has explicit loading state, success/failure feedback, disabled repeat-submit behavior, confirmation where destructive, and preserved backend audit context. | Component tests for critical mutations and manual smoke for destructive workflows. |
| FE-BROWSER-001 | Todo | High | Browser | Split `BrowserPage.tsx` into focused modules for context, bucket/root navigation, object listing, selection, upload, download, object operations, search/filter state, version cleanup, multipart uploads, SSE-C, and embedded profiles. Preserve standalone and embedded behavior. | Existing Browser tests, `rtk npm run lint:browser`, and Browser e2e smoke when runtime behavior changes. |
| FE-BROWSER-002 | Todo | Medium | Browser modals | Split `BrowserObjectDetailsModal.tsx` and related dialog modules into object metadata, tags, retention/legal hold, versions, restore, preview, and copy/download helpers. Keep Portal basic profile restrictions intact. | Targeted modal tests and Browser route smoke. |
| FE-BUCKET-001 | Todo | Medium | Bucket workbench | Refactor `BucketOpsWorkbench.tsx` into shared list/filter/action/progress primitives usable by Storage Ops, Manager, and Ceph Admin without mixing their surface vocabulary or route ownership. | Storage Ops, Manager, and Ceph Admin component tests. |
| FE-BUCKET-002 | Todo | Medium | Bucket config UI | Factor repeated bucket configuration panels and modals across Manager, Browser-adjacent flows, Storage Ops, and Ceph Admin. Pass surface, execution context, actor-visible labels, and capability policy explicitly. | Bucket detail tests, Ceph Admin bucket tests, and visual smoke for touched pages. |
| FE-MANAGER-001 | Todo | Medium | Manager | Split large Manager pages and bucket tools into data hooks, view-model mappers, dialogs, tables, and action controllers. Preserve native S3/IAM terminology and account/connection distinctions. | Manager route tests, targeted page tests, and typecheck. |
| FE-ADMIN-001 | Todo | Medium | Admin | Review Admin pages for duplicated table/action/modal patterns across users, groups, accounts, connections, endpoints, and settings. Extract shared admin primitives only when they preserve governance wording and audit context. | Admin component tests and route smoke for touched pages. |
| FE-CEPH-001 | Todo | Medium | Ceph Admin | Refactor Ceph Admin accounts, users, buckets, and embedded Browser pages so endpoint context, risk acknowledgement, and endpoint-wide impact remain explicit. Avoid Manager shortcuts or tenant-file-work wording. | Ceph Admin route/component tests and manual smoke for endpoint switching. |
| FE-PORTAL-001 | Todo | Medium | Portal | Review Portal pages for user-facing vocabulary, compact end-user states, activity/transfer consistency, access-key self-service, and locked Storage Space Browser behavior. Remove any leftover admin/operator terminology. | `rtk npm run test:portal`, Portal visual QA when layout changes. |
| FE-SHARED-001 | Todo | Medium | Shared components | Split large shared components such as `ProfilePage.tsx` and consolidate reusable primitives for tables, modals, banners, tabs, empty states, confirmation flows, and status badges. Avoid nested cards and workspace-specific themes. | Component tests and docs screenshot checks if visual docs change. |
| FE-A11Y-001 | Todo | Medium | Accessibility | Audit dialogs, drawers, menus, tabs, destructive confirmations, keyboard focus, loading states, empty states, disabled controls, and error banners. Use existing jest-axe tests where practical. | `rtk npm run test:a11y` plus targeted interaction tests. |
| FE-PERF-001 | Todo | Medium | Performance | Review lazy route chunks, shared imports, bundle budgets, expensive Browser renders, large tables, and repeated fetches. Keep route-level lazy loading and avoid introducing chunk cycles. | `rtk npm run build`, `rtk npm run chunks:check`, `rtk npm run budget:check`. |
| FE-TEST-001 | Todo | Medium | Tests | Add route snapshot coverage for path-to-component guard contracts and critical workspace gates. Expand Browser, Portal, Manager, Ceph Admin, and Storage Ops tests only around touched behavior. | Targeted Vitest suites plus `rtk npm run test`. |
| FE-CLEAN-001 | Todo | Low | Dead code | Run `knip` through the existing `deadcode:check` script and remove only confirmed unused files, exports, or fixtures. Keep test fixtures and docs screenshot data unless confirmed unused. | `rtk npm run deadcode:check`, `rtk npm run check`, `rtk git diff --check`. |
| FE-DOCS-001 | Todo | Low | Documentation | Update developer docs when a frontend internal contract changes: route guards, Browser profiles, Portal wording, shared UI primitives, storage-key migrations, or validation workflow. | Docs review plus affected checks. |

## Validation Checklist For Each Lot

Run focused checks first, then broaden based on blast radius.

From `/Users/laurent/ksperis/s3-manager/frontend`:

```bash
rtk npm run lint
rtk npm run lint:browser
rtk npm run typecheck
rtk npm run deadcode:check
rtk npm run test
rtk npm run build
rtk npm run chunks:check
rtk npm run budget:check
```

For a full frontend gate:

```bash
rtk npm run check
```

For Portal-specific work:

```bash
rtk npm run test:portal
rtk npm run typecheck
rtk npm run deadcode:check
```

For Browser runtime work:

```bash
rtk npm run lint:browser
rtk npm run test:e2e
```

For route rendering, feature gates, real workspace navigation, or visible UI
behavior, start Vite and perform a browser-level smoke test:

```bash
rtk npm run dev -- --host 127.0.0.1 --port 5173
```

Then verify the relevant route content, key DOM state, and browser console
errors. Do not commit Playwright reports, temporary screenshots, traces, videos,
tokens, copied secrets, or generated local artifacts.

## Route Snapshot Requirements

Before changing route guards or route layout in `frontend/src/router.tsx`,
capture a route snapshot that records:

- path
- owning surface
- component or lazy loader
- auth role guard
- feature gate
- workspace or execution-context guard
- redirect or disabled-feature behavior

After the change, compare the snapshot and document any intentional difference.
Unexpected route changes should block the lot.

## Manual Review Hotspots

- `frontend/src/router.tsx`: route declarations, guards, feature gates, and
  redirects are centralized and should be split carefully.
- `frontend/src/features/browser/BrowserPage.tsx`: primary refactor hotspot for
  Browser state, object operations, embedded profiles, and large UI flows.
- `frontend/src/features/shared/BucketOpsWorkbench.tsx`: shared bucket tooling
  across operational surfaces; refactors must preserve surface-specific
  vocabulary and action scope.
- `frontend/src/features/manager/BucketDetailPage.tsx`: bucket configuration
  UI with many S3-native capabilities.
- `frontend/src/features/browser/BrowserObjectDetailsModal.tsx`: advanced object
  details and mutations; must respect Portal basic restrictions.
- `frontend/src/api/client.ts` and `frontend/src/api/sseBucketsStream.ts`: token
  storage, refresh, request headers, SSE handling, and error propagation.
- `frontend/src/utils/apiError.ts` and `frontend/src/utils/routeError.ts`: common
  places to harden visible errors and route failures.
- `frontend/src/features/portal`: Portal wording, Storage Space contracts,
  access-key self-service, activity, transfers, and locked Browser profile.
- `frontend/src/features/cephAdmin`: endpoint-wide context and risk-aware
  operations.

## Validation Evidence

- 2026-06-25: Initial inventory recorded in this TODO.
- 2026-06-25: FE-HARD-001 `rtk npm run refactor:inventory` passed.
- 2026-06-25: FE-HARD-002/003/004 targeted tests `rtk npm run test -- src/utils/apiError.test.ts src/utils/runtimeDiagnostics.test.ts src/api/storageOps.stream.test.ts src/api/managerMigrations.stream.test.ts src/features/shared/RouteErrorPage.test.tsx` -> 18 passed.
- 2026-06-25: FE-HARD-002/003/004 broad validation `rtk npm run typecheck` -> passed; `rtk npm run lint:browser` -> passed; `rtk npm run test` -> 771 passed.

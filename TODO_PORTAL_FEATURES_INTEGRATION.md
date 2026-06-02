# TODO - Portal Feature Integration And Product Hardening

## Goal

Continue the development of `/portal` after the Storage Workspace refactor.

This roadmap is for Codex and focuses on turning the Portal V3 experience into
a production-ready user workspace:

- replace remaining mock/read-only surfaces with real data or remove them;
- harden backend/frontend integration around Storage Spaces;
- improve file, sharing, transfer, usage, alert, and preference workflows;
- clean up legacy Portal backend APIs that no longer match the V3 surface;
- prepare Storage Spaces for future concepts such as projects, datasets, and
  collaborative spaces beyond the current v1 bucket mapping.

## Current State

Informational status from `TODO_PORTAL_STORAGE_WORKSPACE.md` and the Portal V3
implementation:

- Portal V3 is implemented as a distinct Storage Workspace.
- `/portal/browser` and the legacy bucket/manage/billing UI pages are removed.
- Canonical Portal routes are:
  - `/portal`
  - `/portal/storage-spaces`
  - `/portal/storage-spaces/:spaceId`
  - `/portal/storage-spaces/:spaceId/objects/*`
  - `/portal/shares`
  - `/portal/activity`
  - `/portal/transfers`
  - `/portal/usage`
  - `/portal/settings`
- `Usage & Analytics`, activity, transfers, shares, and alerts exist, but still
  need integration polish, empty-state tuning, and real-world QA.
- `/portal/users`, `/portal/groups`, `/portal/policies`, and
  `/portal/access-keys` mock/read-only pages have been removed from the
  production Portal route tree.
- Visual responsive QA and screenshots remain incomplete from the previous TODO.

## Non-Negotiable Rules

- Do not add back a Portal browser route or embed the Browser surface in Portal.
- Do not add legacy bucket/manage/billing UI screens back into Portal.
- Do not expose IAM, policy JSON, principals, ARNs, advanced ACLs, S3
  diagnostics, object lock, delete markers, batch operations, or advanced S3
  configuration in the Portal UI.
- Keep `/browser` as the advanced object explorer.
- Keep `/manager` as the advanced S3 and identity configuration workspace.
- Keep `/admin` as the platform governance workspace.
- Keep storage permissions backed by storage-side authorization. UI roles such
  as `Viewer`, `Editor`, and `Owner` must not become a parallel permission
  model.
- Prefer real backend data over mocks. If a feature is not ready, show a clear
  empty or unavailable state instead of fake production data.
- Keep changes scoped to `/portal` unless a shared contract or cleanup requires
  touching another surface.

## Step 1 - UX Validation And Visual QA

Objective: validate the existing Portal V3 UI before adding more behavior.

- [x] Create or document an authenticated local QA scenario with at least one
  Portal account, two Storage Spaces, one shared space, recent activity, one
  transfer, usage metrics, and at least one alert.
- [x] Verify desktop rendering for:
  - `/portal`
  - `/portal/storage-spaces`
  - `/portal/storage-spaces/:spaceId`
  - `/portal/storage-spaces/:spaceId/objects/*`
  - `/portal/shares`
  - `/portal/activity`
  - `/portal/transfers`
  - `/portal/usage`
  - `/portal/settings`
- [x] Verify mobile rendering for the same routes.
- [x] Check that tables, tabs, buttons, metric cards, and side navigation do not
  overlap or truncate important text.
- [x] Check keyboard navigation and visible focus states for main Portal pages.
- [x] Capture reference screenshots for dashboard, Storage Spaces, object list,
  object detail, Usage & Analytics, and Settings.
- [x] Update visual issues before starting deeper feature work.
- [x] Add or update lightweight visual QA notes in user or developer docs.

## Step 2 - Remove Remaining Mocks

Objective: make mock usage explicit, then remove it from production paths.

- [x] Inventory all production imports and usages of `portalWorkspaceMockData.ts`.
- [x] Inventory all user-visible text containing `mock`, `mocked`,
  `preview`, or placeholder-only behavior in Portal pages.
- [x] Define a frontend fallback policy:
  - use real API data first;
  - show an empty state when data is absent;
  - use local deterministic mock data only in tests or isolated demo fixtures.
- [x] Replace mock object metadata and previews with real API data or an
  unavailable state.
- [x] Replace mock public links with real public-link data or hide the section
  behind a clear unavailable state.
- [x] Replace mock admin pages with real pages, or remove those routes from
  Portal if they are out of scope.
- [x] Remove fake action success messages such as local-only create folder,
  create user, create group, create policy, and create access key messages from
  production UI.
- [x] Add tests proving Portal pages do not render mock-only strings in normal
  production states.

## Step 3 - Advanced Storage Spaces

Objective: make Storage Spaces a stronger abstraction while keeping v1 bucket
mapping internal.

- [x] Extend Storage Space API responses only where needed with user-facing
  fields such as display name, description, owner label, status, created date,
  region, quota, usage, object count, and user role.
- [x] Keep `internal_bucket_name` out of primary UI labels.
- [x] Add search, sort, and filter support for Storage Spaces if backend support
  is not already sufficient.
- [x] Add optional Storage Space metadata for future project/dataset concepts.
- [x] Decide whether Storage Space metadata needs database persistence; if yes,
  add a migration and service tests.
- [x] Add create/update/archive flows only if they can be expressed as
  user-facing Storage Space operations without exposing advanced S3 settings.
- [x] Add backend tests for account isolation, role filtering, missing spaces,
  and metadata visibility.
- [x] Add frontend tests for list filtering, empty states, role badges, and
  detail loading failures.

## Step 4 - Sharing, Public Links And Collaboration

Objective: finish collaboration workflows with simple user-facing language.

- [x] Add or finalize endpoints for public links:
  - list links for a Storage Space or object;
  - create a link with optional expiration;
  - revoke a link;
  - report expiring links for dashboard alerts.
- [x] Ensure share roles remain `Viewer`, `Editor`, and `Owner` in Portal UI.
- [x] Connect `Shared with me`, `Shared by me`, and `Public links` to real
  backend data.
- [x] Add share creation, update, and revoke flows with clear confirmation for
  destructive actions.
- [x] Add collaboration activity entries for share grants, updates, revokes,
  and public-link lifecycle events.
- [x] Add backend tests for share role mapping, tenant isolation, public-link
  expiration, and revocation.
- [x] Add frontend tests for share tabs, role labels, optimistic or loading
  states, errors, and empty states.

## Step 5 - Files And Transfers Experience

Objective: make Portal file operations reliable without becoming Browser.

- [x] Replace remaining object-list mock fallbacks with real Portal object
  listings and clear unavailable states.
- [x] Add simple folder creation if supported by the chosen object model.
- [x] Add rename, move, or delete only if they can be implemented safely with
  clear Portal-level permissions and confirmations.
- [x] Keep advanced object features out of Portal object views.
- [x] Connect object detail to real safe metadata only: name, path, size,
  content type, last modified, simple storage class, and simple encryption
  label when available.
- [x] Add real preview only for supported safe text or image content; otherwise
  show a download-oriented empty state.
- [x] Persist or reconcile transfer history so refreshes do not lose completed
  transfers that should remain visible.
- [x] Add transfer retries or failure details if backend data supports them.
- [x] Add tests for upload, download, folder navigation, failed transfers,
  empty folders, and permission-denied states.

## Step 6 - Usage, Alerts And Observability

Objective: turn usage and alerts into reliable user-facing signals.

- [x] Verify `PortalUsage`, traffic, billing, and Storage Space usage agree on
  units, nullability, and account scope.
- [x] Add Storage Space usage breakdown from real backend data if any remaining
  values are derived from mocks.
- [x] Add clear unavailable states for missing quota, missing traffic, missing
  billing, and missing per-space usage.
- [x] Add alert deduplication and severity rules for:
  - quota near limit;
  - public Storage Space or public link;
  - expiring link;
  - failed transfer;
  - degraded endpoint.
- [x] Add dashboard wiring tests proving alerts, activity, transfers, and usage
  are rendered from real API responses.
- [x] Add backend tests for alert generation, tenant isolation, endpoint health
  fallback, and empty alert lists.
- [x] Document what each Portal metric means and when it can be unavailable.

## Step 7 - Legacy Portal Backend Cleanup

Objective: remove or deprecate backend surfaces that no longer match Portal V3.

- [x] Inventory legacy Portal endpoints that are no longer called by the V3 UI.
- [x] Decide for each legacy endpoint whether it should be removed, kept
  temporarily for compatibility, or moved to `/manager` or `/admin`.
- [x] Deprecate or remove legacy `/portal/buckets` endpoints once Storage Space
  endpoints fully cover required behavior.
- [x] Deprecate or remove old Portal bucket-user management endpoints if they
  are replaced by Storage Space shares.
- [x] Deprecate or remove advanced Portal access-key management endpoints if
  they are not part of the simplified Portal product.
- [x] Deprecate or remove Portal compliance endpoints that expose advanced
  backend concepts not intended for end users.
- [x] Keep backend permission checks and audit logging for any retained
  mutating endpoints.
- [x] Update API client code and tests after each removal.
- [x] Update documentation and changelog notes for removed or deprecated
  endpoints.

## Step 8 - Tests, Documentation And Release Readiness

Objective: make the Portal feature set safe to ship and maintain.

- [ ] Add a focused Portal test suite command or documented test group for
  frontend and backend checks.
- [ ] Add route/access tests proving Portal does not expose Browser, Manager,
  or Admin-only pages.
- [ ] Add regression tests for Viewer, Editor, and Owner permissions across
  list, download, upload, share, and settings flows.
- [ ] Add user documentation for the final Portal V3 workflows.
- [ ] Add developer documentation for Portal data flow, service boundaries,
  Storage Space abstraction, and mock policy.
- [ ] Add release notes for breaking route/API removals.
- [ ] Verify bundle/dead-code checks after removing mock and legacy code.
- [ ] Verify that Portal works with no billing, no quota, no traffic metrics,
  no shares, no transfers, and no alerts.

## Global Validation

- [ ] `rtk npm run typecheck`
- [ ] Targeted Portal frontend tests.
- [ ] Backend Portal tests.
- [ ] Permission non-regression tests.
- [ ] `rtk npm run deadcode:check`
- [ ] `rtk git diff --check`
- [ ] Desktop visual QA.
- [ ] Mobile visual QA.
- [ ] Manual final-user workflow:
  - see dashboard;
  - open a Storage Space;
  - browse files;
  - upload and download;
  - share with a collaborator;
  - review activity;
  - review transfers;
  - review usage and alerts;
  - update simple preferences.

## Assumptions

- This TODO extends `TODO_PORTAL_STORAGE_WORKSPACE.md`; it does not replace it.
- The current branch is expected to contain Portal V3 and the surface separation
  cleanup.
- The roadmap is integration-first and hardening-first, not a full visual
  redesign.
- Storage Spaces may still map to buckets in v1, but the UI and future roadmap
  should leave room for projects, datasets, and collaborative spaces.

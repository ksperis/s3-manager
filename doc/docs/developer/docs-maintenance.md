# Docs Maintenance

This page defines coverage expectations for audience-oriented documentation.

## Coverage matrix (routes/features)

| Route / Feature | Target doc page | Status |
|---|---|---|
| First-run user orientation and workspace selection | `user/start-here.md` | Covered |
| `/profile` | `user/profile.md` | Covered |
| User/admin task journeys | `user/common-tasks-storage-user.md` + `user/common-tasks-storage-admin.md` | Covered |
| Storage admin rollout and handover journey | `user/admin-runbook-storage-admin.md` | Covered |
| Feature visibility and missing actions | `user/feature-availability.md` + `user/troubleshooting.md` | Covered |
| Product vocabulary and search terms | `user/glossary.md` | Covered |
| `/admin` dashboard and admin nav | `user/workspace-admin.md` | Covered |
| `/admin/s3-accounts` | `user/workspace-admin.md` | Covered |
| `/admin/s3-users` + keys page | `user/workspace-admin.md` | Covered |
| `/admin/s3-connections` | `user/workspace-admin.md` | Covered |
| `/admin/storage-endpoints` | `user/workspace-admin.md` + `ops/configuration.md` | Covered |
| `/admin/endpoint-status` | `user/feature-endpoint-status-admin.md` + `ops/operations-healthchecks.md` | Covered |
| `/admin/audit` | `user/workspace-admin.md` + `ops/operations-observability.md` | Covered |
| `/admin/metrics` | `user/feature-admin-metrics.md` + `ops/operations-observability.md` | Covered |
| `/admin/billing` | `user/feature-billing-admin.md` + `ops/operations-billing.md` | Covered |
| `/admin/usage-history` | `user/feature-usage-history-admin.md` + `ops/operations-quota-monitoring.md` | Covered |
| API tokens (account menu modal) | `ops/operations-api-tokens.md` | Covered |
| `/admin/*-settings` | `ops/configuration.md` | Covered |
| `/admin/key-rotation` | `user/feature-key-rotation-admin.md` + `ops/operations-security.md` | Covered |
| `/ceph-admin` and children | `user/workspace-ceph-admin.md` | Covered |
| `/ceph-admin/buckets` advanced drawer | `user/howto-ceph-advanced-filter.md` | Covered |
| `/ceph-admin/buckets` UI tags operations | `user/howto-ceph-ui-tags.md` | Covered |
| `/storage-ops` and children | `user/workspace-storage-ops.md` | Covered |
| `/storage-ops/buckets` UI tags operations | `user/howto-storage-ops-ui-tags.md` | Covered |
| `/manager` dashboard/nav | `user/workspace-manager.md` | Covered |
| `/manager/buckets` and detail | `user/feature-buckets.md` | Covered |
| `/manager/buckets/:bucket` configuration flow | `user/howto-manager-bucket-configuration.md` | Covered |
| `/manager/browser` | `user/feature-objects-browser.md` | Covered |
| `/manager/users|groups|roles|iam/policies` | `user/feature-iam.md` | Covered |
| `/manager/ceph/keys` | `user/feature-manager-ceph-keys.md` | Covered |
| `/manager/topics` | `user/feature-topics.md` | Covered |
| `/manager/feature-rules` | `user/feature-buckets.md` + `developer/listings-feature-matrix.md` | Covered |
| `/manager/bucket-compare` | `user/feature-bucket-compare.md` | Covered |
| `/manager/bucket-integrity` | `user/feature-bucket-integrity-check.md` | Covered |
| `/manager/bucket-purge`, `/ceph-admin/buckets` purge action, `/storage-ops/buckets` purge action | `user/feature-bucket-purge.md` | Covered |
| `/manager/metrics`, `/ceph-admin/metrics`, and bucket usage stats tabs/actions | `user/feature-bucket-usage-stats.md` | Covered |
| `/manager/migrations*` | `user/feature-bucket-migration.md` | Covered |
| `/portal` and children | `user/workspace-portal.md` + Portal task pages | Covered |
| `/portal/storage-spaces*` | `user/portal-storage-spaces.md` + `user/portal-files.md` | Covered |
| `/portal/shares*` and public-link/collaboration concepts | `user/portal-sharing.md` | Covered |
| `/portal/access-keys` | `user/portal-access-keys.md` | Covered |
| `/portal/usage` and Portal alerts | `user/portal-usage-alerts.md` | Covered |
| `/portal/activity` | `user/portal-activity.md` | Covered |
| `/portal/transfers` | `user/portal-transfers.md` | Covered |
| `/portal/settings` | `user/portal-settings.md` | Covered |
| `/browser` | `user/workspace-browser.md` + `user/feature-objects-browser.md` | Covered |
| `/browser` object versions modal | `user/feature-object-versions-browser.md` | Covered |
| Feature flags in app settings | `ops/configuration.md` + user pages limits blocks | Covered |
| Destructive and bulk operation safety | `user/safe-destructive-operations.md` + tool pages | Covered |
| Production readiness and recovery | `ops/production-readiness.md` + `ops/backup-restore.md` | Covered |
| First contribution path | `developer/first-contribution.md` + `developer/contributing.md` | Covered |

## Maintenance rule

When adding or changing routes/features:

1. Update user-facing page in `doc/docs/user/`.
2. Update ops/developer pages when runtime behavior or architecture changed.
3. Keep this matrix in sync with `frontend/src/router.tsx` and workspace layouts.
4. Run the strict docs build and screenshot reference check before publishing:

```bash
python3 -m mkdocs build --strict --config-file doc/mkdocs.yml --site-dir /tmp/s3-manager-docs-build
npm --prefix frontend run docs:screenshots:check
```

## Visual theme maintenance

The documentation theme intentionally mirrors the application UI language.
Before changing documentation styling:

1. Start from `frontend/src/index.css` and
   `doc/docs/developer/ui-theme-guidelines.md`.
2. Keep MkDocs colors, borders, radii, shadows, active navigation, tables, and
   screenshot components on the mirrored `--ui-*` and `--shell-*` tokens in
   `doc/docs/assets/stylesheets/docs-theme.css`.
3. Preserve the compact application posture: restrained headings, reduced
   vertical gaps, dense tables, compact primary navigation, compact table of
   contents, and screenshot controls that do not crowd the actual capture.
4. Avoid documentation-only palettes or decorative effects that do not exist in
   the application workspace surfaces.
5. Validate the rendered result on desktop and mobile, especially pages with
   wide tables and screenshot galleries.

## User screenshot workflow

User pages in `doc/docs/user/*.md` normally include exactly one themed screenshot block:

```html
<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/<page-screenshot>.light.png" alt="..." loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/<page-screenshot>.dark.png" alt="..." loading="lazy">
</div>
```

Use `../../assets/...` for published user pages under `/user/<slug>/`.
Only `doc/docs/user/index.md` stays on `../assets/...` because it renders at `/user/`.

Published docs automatically enhance screenshots under `assets/screenshots/` so a click opens them in a fullscreen viewer.

Exception:

- `user/screenshots-gallery.md` is a curated gallery page and may include multiple themed screenshot blocks inside HTML `<figure>` tags.

Most screenshots are generated with synthetic/mock data using Playwright:

```bash
npm --prefix frontend run docs:screenshots
```

The generator writes both variants for each logical screenshot:

- `basename.light.png`
- `basename.dark.png`

Validate references and dimensions (1728x972 for both variants) before merging:

```bash
npm --prefix frontend run docs:screenshots:check
```

If you add a new standard user page:

1. Add a scenario in `frontend/scripts/docs-screenshots/scenarios.ts` with route, storage seed, mocks, and output basename.
2. Generate screenshots.
3. Add one themed screenshot block to the new markdown page.
4. Run the screenshot check script.

If a new task page reuses an existing validated screenshot, document why that
screenshot is the best visual anchor and still run the screenshot check script.

If you update the gallery page:

1. Add or update the required screenshot scenarios in `frontend/scripts/docs-screenshots/scenarios.ts`.
2. Generate screenshots.
3. Reference the curated screenshots from `user/screenshots-gallery.md` using themed screenshot blocks.
4. Run the screenshot check script.

Portal screenshot note:

- `workspace-portal` follows the same `.light.png` / `.dark.png` convention as other active workspace screenshots.

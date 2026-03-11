# Docs Maintenance

This page defines coverage expectations for audience-oriented documentation.

## Coverage matrix (routes/features)

| Route / Feature | Target doc page | Status |
|---|---|---|
| `/admin` dashboard and admin nav | `user/workspace-admin.md` | Covered |
| `/admin/s3-accounts` | `user/workspace-admin.md` | Covered |
| `/admin/s3-users` + keys page | `user/workspace-admin.md` | Covered |
| `/admin/s3-connections` | `user/workspace-admin.md` | Covered |
| `/admin/storage-endpoints` | `user/workspace-admin.md` + `ops/configuration.md` | Covered |
| `/admin/endpoint-status` | `user/workspace-admin.md` + `ops/operations-healthchecks.md` | Covered |
| `/admin/audit` | `user/workspace-admin.md` + `ops/operations-observability.md` | Covered |
| `/admin/billing` | `user/workspace-admin.md` + `ops/operations-billing.md` | Covered |
| `/admin/api-tokens` | `ops/operations-api-tokens.md` | Covered |
| `/admin/*-settings` | `ops/configuration.md` | Covered |
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
| `/manager/topics` | `user/feature-topics.md` | Covered |
| `/manager/bucket-compare` | `user/feature-bucket-compare.md` | Covered |
| `/manager/migrations*` | `user/feature-bucket-migration.md` | Covered |
| `/browser` | `user/workspace-browser.md` + `user/feature-objects-browser.md` | Covered |
| `/portal` and children | `user/workspace-portal.md` | Covered |
| Feature flags in app settings | `ops/configuration.md` + user pages limits blocks | Covered |

## Maintenance rule

When adding or changing routes/features:

1. Update user-facing page in `doc/docs/user/`.
2. Update ops/developer pages when runtime behavior or architecture changed.
3. Keep this matrix in sync with `frontend/src/router.tsx` and workspace layouts.

## User screenshot workflow

User pages in `doc/docs/user/*.md` must include exactly one screenshot reference:

`![...](../assets/screenshots/user/<page-screenshot>.png)`

The screenshots are generated with synthetic/mock data using Playwright:

```bash
npm --prefix frontend run docs:screenshots
```

Validate references and dimensions (1728x972) before merging:

```bash
npm --prefix frontend run docs:screenshots:check
```

If you add a new user page:

1. Add a scenario in `frontend/scripts/docs-screenshots/scenarios.ts` with route, storage seed, mocks, and output file.
2. Generate screenshots.
3. Add one screenshot reference to the new markdown page.
4. Run the screenshot check script.

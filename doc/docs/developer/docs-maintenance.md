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
| `/manager` dashboard/nav | `user/workspace-manager.md` | Covered |
| `/manager/buckets` and detail | `user/feature-buckets.md` | Covered |
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

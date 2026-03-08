# Feature: Bucket Migration

## When to use

Use this guide to migrate buckets between contexts with verification and operator controls.

## Prerequisites

- Access to `/manager/migrations`.
- `bucket_migration_enabled` enabled.
- Role authorized for migration (`ui_admin`, `ui_superadmin`, and optionally `ui_user` when allowed).

## Steps

1. Open **Manager > Tools > Migration**.
2. Click **New migration**.
3. Configure endpoints, bucket mappings, and advanced options:
   - migration mode: `One-shot` or `Pre-sync + cutover`
   - optional target write lock
   - optional source deletion (only after clean verification)
4. Validate review/precheck results and resolve all blocking errors.
5. Launch replication.
6. Monitor status and use operator controls:
   - `Pause` / `Resume` / `Stop`
   - `Continue after pre-sync` (cutover flow)
   - retry and rollback actions for failed items
7. Confirm final verification before enabling or accepting source deletion.

## Expected result

Migration runs with explicit progress, safety checks, and auditable operator decisions.

## Limits / feature flags

!!! note
    Feature requires `bucket_migration_enabled`. UI user access depends on `allow_ui_user_bucket_migration`. Some options only apply to same-endpoint scenarios and capability checks.

## Related pages

- [Workspace: Manager](workspace-manager.md)
- [Feature: Bucket compare](feature-bucket-compare.md)

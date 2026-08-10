# Feature: Bucket Migration

## When to use

Use this guide to migrate buckets between contexts with verification and operator controls.

## Prerequisites

- Access to `/manager/migrations`.
- `bucket_migration_enabled` enabled.
- A UI user with **Manager > Bucket migration** access enabled.

## Before you start

Run a comparison or inventory check first when the source and target already contain data. Migration decisions should be based on known differences, not on bucket names alone.

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

## You are done when

Prechecks are clean, the run reaches its expected final state, and any cutover, retry, rollback, or source-deletion action is explicitly reviewed.

## If you do not see this action

Check `bucket_migration_enabled`, Manager tool access, and whether the selected source and target contexts support the selected migration mode.

## Limits / feature flags

!!! note
    Feature requires `bucket_migration_enabled` globally and the per-user Manager tool right `bucket_migration`. Some options only apply to same-endpoint scenarios and capability checks.

## Related pages

- [Workspace: Manager](workspace-manager.md)
- [Feature: Bucket compare](feature-bucket-compare.md)
- [Safe destructive and bulk operations](safe-destructive-operations.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/feature-bucket-migration.light.png" alt="Bucket migration page with status filters and runs" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/feature-bucket-migration.dark.png" alt="Bucket migration page with status filters and runs" loading="lazy">
</div>

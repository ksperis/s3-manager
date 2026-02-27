# Bucket Migration Tool

The Bucket Migration tool is a Manager operator feature used to migrate one or more buckets from a source to a target context, with review checks, live progress, and data-loss safeguards.

## Access and enablement

Enable the feature in **Admin > General settings > EXTRA FEATURES**:

- `Bucket migration tool`: global ON/OFF switch.
- `Allow UI User access to bucket migration`: OFF by default.
  - OFF: only `UI Admin` and `UI Superadmin`.
  - ON: `UI User` can use the feature too.

When disabled, Manager migration APIs return `403` and the migration route is not accessible.

## What this feature migrates

- Current objects only.
- Historical object versions are not replicated in this version.
- Metadata replication is not part of the current migration scope.

## Before you start

1. Select the source context in the global context selector.
2. Open **Manager > Tools > Migration**.
3. Click **New migration**.

The source is always the currently selected context. You only choose the target in the modal.

## Create a migration

The **New migration** modal lets you configure:

1. **Endpoints**
   - Source: current selected context (read-only display).
   - Target: context selector.
2. **Bucket mapping**
   - Select one or more source buckets.
   - Optional target prefix mapping.
   - Optional per-bucket target override.
3. **Advanced options**
   - `One-shot migration` or `Pre-sync + cutover`
   - `Copy bucket settings`
   - `Lock target writes during migration`
   - `Auto-grant temporary source read for same-endpoint copy`
   - `Delete source if diff is clean`
   - `Webhook URL` (called on each migration event)

After creation, review/precheck is run automatically. If review passes, the next step is **Launch replication**.

## Migration modes

- **One-shot migration**
  - Runs full sync, verification, and optional source deletion in one flow.
- **Pre-sync + cutover**
  - Runs pre-sync first, then waits in `awaiting_cutover`.
  - Operator clicks **Continue after pre-sync** to run the final cutover sync and verification.

## Execution flow per bucket

For each source -> target mapping:

1. Create target bucket.
2. Copy bucket settings (optional).
3. Apply target write lock (optional, migration worker remains authorized).
4. Pre-sync (pre-sync mode only).
5. Apply source read-only protection.
6. Sync or re-sync data (including deletion propagation on final sync).
7. Final verify (diff).
8. Strong verification for size-only comparisons.
9. Delete source bucket (optional, only when all safety checks pass).

If target bucket already exists, that bucket item is skipped.

## Review and precheck

Review validates prerequisites before launch:

- Source list/read permissions.
- Target existence checks.
- Policy read/write roundtrip checks for source and target lock steps.
- Same-endpoint `x-amz-copy-source` permissions.

Use the review panel to resolve blocking errors before launching replication.

## Copy strategy and performance

- Same endpoint: tries `CopyObject` with `x-amz-copy-source`.
- If `CopyObject` is denied, falls back to stream copy (`GetObject` + upload).
- Copy and delete operations run in parallel with bounded concurrency.
- When enabled, temporary source-read grant is applied only during same-endpoint sync windows and then restored.

Global concurrency defaults and limits are configured in **Admin > Manager settings > Bucket migration controls**:

- Default parallelism
- Max parallelism per migration
- Max active migrations per endpoint

## Operator actions during and after run

Available controls depend on status:

- `Launch replication`
- `Pause` / `Resume`
- `Stop`
- `Continue after pre-sync`
- `Retry all failed` / `Retry bucket`
- `Rollback all failed` / `Rollback bucket`
- `Delete migration` (final states only)

`Rollback migration` is only offered when rollback is considered safe.

## Safety model

This feature is designed to minimize data-loss risk:

- Source is protected in cutover by policy (read-only behavior).
- Optional target write lock prevents external writes during migration.
- Final source deletion is allowed only when final diff is clean.
- For objects without usable MD5 comparison:
  - Compare checksums from `HeadObject` when available.
  - Otherwise compare streamed SHA-256 source vs target.
- If strong verification is incomplete or fails, source deletion is blocked.
- Rollback is blocked when source data may already be deleted.

## Webhook events

If `Webhook URL` is set, each migration event triggers an HTTP POST with:

- migration-level status and counters
- optional bucket item status/step/counters
- event level/message/metadata

Use this to feed external monitoring, notifications, or controlled cutover orchestration.

## Recommended production pattern

1. Use **Pre-sync + cutover**.
2. Resolve all review errors.
3. Run pre-sync.
4. Schedule a cutover window.
5. Run **Continue after pre-sync**.
6. Confirm final verification before allowing source deletion.

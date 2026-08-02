# Operations: Upgrade and Compatibility Notes

## 2026-08 timezone-aware UTC migration

Migration `0074_timezone_aware_utc_timestamps` converts every persisted
PostgreSQL timestamp to `TIMESTAMP WITH TIME ZONE`. Existing values are
interpreted explicitly as UTC during the conversion; no server or session
timezone is consulted. The application now rejects timezone-naive datetime
writes and serializes persisted values with an explicit UTC offset.

Stop all backend instances and workers before applying the migration, because
old code still writes and compares naive values. Back up the database, run
Alembic through revision `0074`, then deploy the backend and frontend together.
On large PostgreSQL tables, plan a maintenance window: each altered table is
locked while PostgreSQL rewrites or validates its timestamp columns.

SQLite has no timezone-bearing timestamp storage, so the migration does not
rewrite its columns. The SQLAlchemy adapter still rejects naive application
writes, stores the normalized UTC wall-clock representation, and restores an
aware UTC value on every read. Back up the database, `-wal`, and `-shm` files as
one consistent set before upgrading.

Downgrade converts PostgreSQL values back to timezone-naive UTC. It does not
restore the old application contract; deploy compatible code at the same time
if a downgrade is unavoidable.

## 2026-08 managed private access migration

Migration `0070_managed_private_access` is DB-only. It adds
`s3_connections.server_managed` with a false default and creates the durable
`managed_private_accesses` saga table. Existing connections and remote RGW/IAM
resources are not modified, adopted, or contacted during Alembic.

Deploy backend and frontend together so Manager does not expose a provisioning
action before the specialized endpoints and immutable-credential rules are
available. After upgrade, smoke-test both **Create my private access** branches,
Profile deletion, and **Retry cleanup**. A `cleanup_pending` row is operational
state, not disposable bookkeeping: retain it until the idempotent remote
cleanup succeeds.

Downgrade removes only the new table and marker column. It cannot clean up
remote identities or keys already created by the application; delete every
server-managed private connection through the running orchestrator before
downgrading.

## 2026-08 canonical access model migration

Migration `0069_canonical_account_access_roles` is a breaking, DB-only
migration. It replaces the two account-association dimensions with one ordered
`role`, removes the legacy columns in the same release, and makes shared S3
connections Manager-only.

The backend API accepts and returns only the canonical `role`; backend and
frontend must therefore be deployed together across this migration boundary.

### Required deployment sequence

Rolling upgrade is prohibited because old backend instances and workers still
expect the removed columns.

1. Stop old application instances and every background worker.
2. Create and verify a restorable database backup. For SQLite, include the
   database, `-wal`, and `-shm` files as one consistent set. For PostgreSQL,
   validate the dump by restoring it to a separate database.
3. If the migration reports associations without useful rights, set
   `S3_MANAGER_DB_BACKUP_VERIFIED=true` only after that restore verification.
4. Run Alembic through revision `0069` while the old processes remain stopped.
5. Deploy the new backend and frontend together, then start new workers.
6. Run `python -m app.scripts.reconcile_portal_iam` first in its default dry-run
   mode. Review the per-account summary and then rerun with `--apply`.
7. Smoke-test Admin associations, shared-connection remediation, empty/private
   Browser, Manager Browser, Portal, direct S3 sessions, and Ceph Admin Browser.

Alembic never contacts RGW. Portal IAM reconciliation is intentionally a
separate, resumable command; a partial IAM failure must not alter the canonical
database role.

### Data transformation

- `portal_user`, `portal_manager`, and `account_administrator` are the only
  stored account roles.
- Root account links always become `account_administrator`.
- A legacy admin flag outranks a legacy Portal role.
- Associations that previously granted no useful right are **deleted**, not
  retained with `role = NULL`. No tombstone or compatibility row is written.
- Shared connections have Browser access disabled. Those with Manager access
  stay ready; the others receive the stable remediation reason
  `shared_connection_manager_access_disabled`.
- Private connection owners, credentials, activity flags, and access flags are
  unchanged.

The downgrade reconstructs the legacy schema and fields for surviving rows. It
cannot recreate deleted no-right associations; restoring the verified backup is
the only recovery path for that explicitly non-reversible data.

## 2026-07 Portal Storage Space access migration

Migration `0066_portal_storage_space_access_model` clears the database state of
existing Portal Storage Spaces before installing the strict private/team access
model. It removes their grants, external-credential records, and public links.
It does not contact RGW or delete storage-side resources.

1. Back up the application database and record the spaces that must be recreated.
2. Before upgrading, remove the old Storage Spaces and revoke their external IAM
   credentials through the application workflow. This must happen before Alembic
   because a database migration cannot revoke RGW-side credentials.
3. Apply the database migration. Any remaining Portal database metadata is
   purged transactionally; unrelated public links are preserved.
4. Recreate private spaces or re-import team spaces so bucket policies, IAM
   identities, and fixed Portal groups are provisioned with the strict model.

There is no runtime conversion or compatibility path for old Owner grants,
shared-space owners, or editable Portal IAM policies.

## 2026-08 S3 connection credential owner types

Migration `0073_canonical_connection_owner_types` makes connection identity
metadata strict. It converts `rgw_user` to the canonical `s3_user`, trims and
normalizes the supported values, clears unsupported owner types, and installs a
database constraint. The only stored values are now `iam_user`, `account_user`,
`s3_user`, or `NULL`.

The downgrade removes the constraint but does not recreate noncanonical values.
Back up the application database before the migration if those values must be
inspected or exported.

## 2026-03 compatibility cleanup

Current behavior after cleanup:

- API context selectors reject legacy account inputs (`-1`, `null`, negative ids) with `400`.
- Frontend context persistence uses `selectedExecutionContextId` (and `ctx` URL param).
- Legacy local storage keys (`selectedS3AccountId`, `selectedBrowserContextId`) are ignored.
- Feature locking no longer maps legacy env flags (`BILLING_ENABLED`, `HEALTHCHECK_ENABLED`) into `general_feature_locks`.

## Operator guidance

- Remove scripts relying on legacy selector values.
- Validate UI context persistence after upgrades.
- Use explicit `FEATURE_*` controls for forced feature state.
- Back up the application database before migrations.
- Confirm the credential encryption key is unchanged after restore or redeploy.
- Validate the Admin, Manager, Portal, and Browser entry routes with the intended roles after upgrade.

## Related pages

- [Configuration](configuration.md)
- [Production readiness](production-readiness.md)
- [Backup and restore](backup-restore.md)
- [Developer docs maintenance](../developer/docs-maintenance.md)

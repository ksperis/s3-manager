# Operations: Upgrade and Compatibility Notes

## 2026-08 canonical access model migration

Migration `0069_canonical_account_access_roles` is a breaking, DB-only
migration. It replaces the two account-association dimensions with one ordered
`role`, removes the legacy columns in the same release, and makes shared S3
connections Manager-only.

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

# Operations: Upgrade and Compatibility Notes

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

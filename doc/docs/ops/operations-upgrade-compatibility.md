# Operations: Upgrade and Compatibility Notes

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

## Related pages

- [Configuration](configuration.md)
- [Developer docs maintenance](../developer/docs-maintenance.md)

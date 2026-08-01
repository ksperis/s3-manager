# Operations: Admin Automation API

The Admin Automation API applies idempotent administrative changes.

## Main endpoint

- `POST /api/admin/automation/apply`

Single-resource endpoints also exist for targeted automation calls.

## Typical resources

- Storage endpoints
- UI users
- S3 accounts
- S3 users
- S3 connections
- Account links

## Execution model

- `dry_run` for simulation.
- `continue_on_error` for batch behavior.
- Response returns `changed`, `success`, summaries, and per-item details.

## S3 connection boundary

Automation can create, find, modify, remediate, or delete shared connections
only. ID and name selectors always include the shared scope, so a private
connection is indistinguishable from a missing resource. Connection specs do
not accept `is_shared`, `access_manager`, or `access_browser`; new connections
are shared, Browser-disabled, and Manager-enabled. A migrated connection in
remediation is enabled only through the explicit `activate_manager` action.

Account-link creation requires canonical `role`, except for a convertible
legacy payload during the compatibility release. Conflicting canonical and
legacy roles are rejected. Removing a link deletes the association instead of
retaining an empty-role row.

## Authentication

Use admin session token or admin API token.

## Related pages

- [Operations: API tokens](operations-api-tokens.md)
- [Operations: security](operations-security.md)

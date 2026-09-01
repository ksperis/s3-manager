# Operations: Admin Automation API

The Admin Automation API applies idempotent administrative changes.

## Endpoint

- `POST /api/admin/automation/apply`

## Typical resources

- Storage endpoints
- UI users
- External identities
- S3 accounts
- S3 users
- S3 connections
- Account links

## Execution model

- `dry_run` for simulation.
- `continue_on_error` for batch behavior.
- Response returns `changed`, `success`, summaries, and per-item details.

`external_identities` identifies an immutable external subject with
`provider_type`, `provider_id`, and `subject`, and selects the target UI user by
ID or email. Applying `present` is idempotent. A revoked mapping requires
`restore: true`; applying `absent` revokes it. A subject owned by another user
is an explicit conflict. Dry-run responses and audit events never expose the
subject.

## S3 connection boundary

Automation can create, find, modify, remediate, or delete shared connections
only. ID and name selectors always include the shared scope, so a private
connection is indistinguishable from a missing resource. Connection specs do
not accept `is_shared`, `access_manager`, or `access_browser`; new connections
are shared, Browser-disabled, and Manager-enabled. A migrated connection in
remediation is enabled only through the explicit `activate_manager` action.

Every account-link item requires both `manager_role` and `portal_role`.
`state: present` requires at least one non-null value; `state: absent` requires
both values to be `null`. The removed `role` and `is_root` fields are rejected.
Removing one axis preserves the other; removing the last right deletes the
association.

## Authentication

Use admin session token or admin API token.

## Related pages

- [Operations: API tokens](operations-api-tokens.md)
- [Operations: security](operations-security.md)

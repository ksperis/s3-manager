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

## Authentication

Use admin session token or admin API token.

## Related pages

- [Operations: API tokens](operations-api-tokens.md)
- [Operations: security](operations-security.md)

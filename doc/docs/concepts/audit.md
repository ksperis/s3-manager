
# Auditability

Auditability is a core requirement for any storage console.

## What should be auditable

At minimum:

- authentication events (login success/failure)
- administrative changes (accounts, endpoints, settings)
- IAM mutations (user/group/role/policy changes)
- bucket mutations (create/delete, versioning, object lock, lifecycle)
- sensitive object operations (delete, restore, legal hold changes)

## Current code pointers

The backend contains an audit module:

- `backend/app/db/audit.py`

Depending on your ongoing roadmap, you may extend audit events to include:

- executor identity used for the operation
- request correlation IDs
- diff-like payloads for policy changes

## Recommendation

For production deployments, consider:

- shipping audit events to a log pipeline (e.g., syslog/ELK/Loki)
- maintaining an immutable retention policy
- adding a tamper-evident chain (hash chaining) if required by compliance

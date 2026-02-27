
# Manager surface

The Manager surface is intended for account-scoped administration aligned with S3/IAM semantics.

## Typical capabilities

- Account dashboard and usage
- Bucket lifecycle:
  - create/delete
  - versioning
  - object lock (when supported)
  - tags and “block public access” style controls (backend-dependent)
- Object browser (manager mode)
- IAM resources:
  - users, groups, roles
  - policies and attachments
- Bucket migration operations from **Tools > Migration**

## Implementation pointers

Backend routers:

- `backend/app/routers/manager_*`
- `backend/app/routers/iam_*`

Frontend routes:

- `/manager/*`

## Related guides

- [Bucket Migration tool](bucket-migration.md)

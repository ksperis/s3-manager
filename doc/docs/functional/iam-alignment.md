
# IAM alignment

This section explains *how* s3-manager aligns strictly with S3/IAM semantics
and how this affects user workflows.

## IAM remains authoritative

s3-manager never evaluates authorization rules itself. For any operation:

1. The UI identity is authenticated and authorized to *use the UI surface*
2. The backend selects a **storage executor** (account root, IAM user, role, or connection)
3. The operation is executed via standard S3/IAM APIs
4. Any denial is returned as-is (e.g. `AccessDenied`)

s3-manager does **not**:
- override IAM decisions
- add implicit privileges
- store hidden permissions

## UX consequences

- The UI may *hide* actions the user is not supposed to perform,
  but the backend never relies on UI filtering for security.
- When IAM policies change outside s3-manager, the UI reflects the new reality immediately.
- Errors are sometimes “raw” S3/IAM errors; this is intentional.

## Typical example

A Manager user tries to delete a bucket:
- UI allows navigation to the bucket
- Backend executes `DeleteBucket`
- IAM denies → `AccessDenied`
- Error is surfaced and audited

This preserves trust and auditability.

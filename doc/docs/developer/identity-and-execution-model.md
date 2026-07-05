# Identity and Execution Model

## Separation of identities

- **UI identity**: who can access which workspace.
- **Storage executor identity**: which credentials are used for storage actions.

## Context and executor

- `/manager` and `/browser` rely on execution context selection.
- `/portal` uses an explicit account or Project context and Portal IAM identities for self-service workflows.
- Backend resolves executor from selected context and policy constraints.

## Portal execution identities

Portal has three execution modes:

- **User Portal IAM identity** for file-level Storage Space work. Object list,
  detail, preview, download, upload, folder creation, and delete use the current
  user's Portal IAM runtime key after DB-backed Storage Space role checks.
- **Controlled account orchestration** for workflows that need account-level
  S3 or IAM changes. Storage Space creation/import, share projection, hidden
  runtime-key provisioning, user-managed Portal access-key lifecycle, bucket
  policy sync, and bucket-level replication use stored `S3Account` RGW
  credentials after Portal role checks and audit logging.
- **Project IAM projection** for Project workspaces. User-managed Project
  access keys are scoped to one UI user, Project, and Ceph zonegroup in
  `project_iam_users`; the backend mutates them with the zonegroup authority
  `S3Account` credentials and projects only DB-backed Storage Space grants for
  that Project. It does not use Ceph Admin endpoint credentials.
- **Read-only operational identities** for usage, quota, health, billing, and
  alert summaries. These reads must tolerate missing backend capabilities and
  must not expose hidden buckets or operator diagnostics in Portal UI.

Portal orchestration is scoped to the selected S3 Account or Project. It must
not silently switch to S3 Connection credentials, legacy S3 users, or Ceph Admin
endpoint credentials. Keep the detailed action matrix in
[Workspace surface separation](workspace-surface-separation.md#portal-execution-identity-matrix)
up to date whenever a Portal route adds a storage mutation or changes executor
identity.

## Practical impact

A single UI user can have access to multiple accounts/connections/endpoints while keeping execution explicit and auditable.

# Upgrade to Kaelo 0.2.0

Kaelo 0.2.0 is an intentionally incompatible product rename. It does not read
the former runtime identifiers and does not provide compatibility aliases. Use
this page as the migration runbook; it is the only active documentation page
that retains the former names so operators can perform an explicit cutover.

## Contract changes

| Before 0.2.0 | Kaelo 0.2.0 |
|---|---|
| Project and repository `s3-manager` | `kaelo` |
| Frontend package `s3-manager-frontend` | `kaelo-frontend` |
| Compose project inferred as `s3-manager` | Explicit project `kaelo` |
| `S3_MANAGER_TAG` | `KAELO_TAG` |
| `S3_MANAGER_BACKEND_IMAGE` | `KAELO_BACKEND_IMAGE` |
| `S3_MANAGER_FRONTEND_IMAGE` | `KAELO_FRONTEND_IMAGE` |
| `S3_MANAGER_DB_BACKUP_VERIFIED` | `KAELO_DB_BACKUP_VERIFIED` |
| JWT issuer `s3-manager` | `kaelo` |
| JWT audiences `s3-manager-ui`, `s3-manager-api`, `s3-manager-pre-auth` | `kaelo-ui`, `kaelo-api`, `kaelo-pre-auth` |
| Helm chart and release examples `s3-manager` | `kaelo` |
| PostgreSQL user and database `s3manager` | `kaelo` |
| Generated Ceph, IAM, and S3 prefix `s3m-` | `klo-` |
| Policy SID prefix `S3Manager` | `Kaelo` |
| GHCR packages `s3-manager-backend` and `s3-manager-frontend` | `kaelo-backend` and `kaelo-frontend` |

The JWT change disconnects all users and invalidates existing UI sessions and
API tokens. Plan to reissue API tokens after the cutover. WebAuthn credentials
remain valid when the public host and RP ID stay unchanged; require
re-enrolment only if either one changes.

## Mandatory preflight

1. Announce a maintenance window and stop writes before the final backup.
2. Create and test a restorable backup of the application database, persisted
   settings, deployment manifests, and the exact JWT and credential-encryption
   keyrings. Restore the same credential-encryption keys after the upgrade or
   encrypted storage credentials will be unreadable.
3. Finish or cancel every bucket migration. Confirm that no migration job is
   active and that every temporary source grant, read-only policy, and target
   write lock has been removed.
4. Export an inventory of managed private access records, including owner,
   execution context, storage endpoint, permissions, and display name.
5. Export an inventory of administrative Ceph identities, capabilities, and
   the Kaelo connection that consumes each credential.
6. Disable Portal server-access logging, reconcile the old target, and archive
   its log objects before changing the deployment.

Do not set `KAELO_DB_BACKUP_VERIFIED=true` until the restore test has passed.
Set it only for the migration process that consumes the verified backup.

## Migrate managed storage identities

### Managed private access

While the previous application is still available, delete each managed private
access through that application so its `s3m-*` IAM user, keys, and policies are
removed remotely. After Kaelo is running, recreate the recorded accesses. The
new principals use the `klo-private-*` contract. Validate each connection before
discarding the inventory.

### Administrative Ceph identities

Create the replacement `klo-admin`, `klo-supervision`, and `klo-ceph-admin`
principals before revoking `s3m-admin`, `s3m-supervision`, and `s3m-ceph-admin`.
Copy the required capabilities exactly, update the stored credentials in Kaelo,
and validate every administrative action with the replacement identity. Revoke
the former identities only after all checks pass.

### Portal server-access logs

Keep Portal logging disabled during the cutover. Archive or copy the objects
from the former `s3m-portal-access-logs-*` target, then enable logging in Kaelo
to create a `klo-portal-access-logs-*` bucket. Copy any history that must remain
available, verify that Kaelo can read it and that new events arrive, then remove
the former bucket according to the retention policy.

## Docker Compose cutover

1. Stop the previous stack without deleting volumes:

   ```bash
   docker compose down
   ```

   Never add `--volumes` during this operation.

2. Determine the actual source volume with `docker volume ls`. A checkout named
   `s3-manager` commonly created `s3-manager_backend-data`; do not assume that
   name without verifying it.
3. Create `kaelo_backend-data` and copy the stopped SQLite data into it. For
   example, after confirming both exact volume names:

   ```bash
   docker volume create kaelo_backend-data
   docker run --rm \
     -v s3-manager_backend-data:/from:ro \
     -v kaelo_backend-data:/to \
     alpine:3.20 sh -c 'cp -a /from/. /to/'
   ```

4. Rename all `S3_MANAGER_*` variables according to the contract table and use
   the Kaelo compose file. Preserve the JWT and credential keyrings.
5. Start the `kaelo` project, apply migrations once with the verified-backup
   gate, then remove the gate and restart normally.

For external PostgreSQL, do not copy a Docker volume. Back up and restore the
database with the provider tooling, create or grant the `kaelo` database role
as required, and update `DATABASE_URL` atomically.

## Helm cutover

A Helm release and its generated PersistentVolumeClaim names cannot be renamed
safely in place. Deploy a new release named `kaelo` from `helm/kaelo` and attach
or restore the data deliberately:

1. Back up the database, application persistence, and the Secret referenced by
   `backend.existingSecret`.
2. Preserve `ui-jwt-keys`, `api-jwt-keys`, `credential-keys`, and
   `internal-cron-token`. Use the same credential-encryption keys in the new
   Secret.
3. For an external database, point the new release at the restored or retained
   database. For chart-managed persistence, restore into a new Kaelo PVC or
   bind a prepared volume according to the cluster storage policy.
4. Install the new release, run the gated migration, validate it, and only then
   retire the `s3-manager` release and its PVCs.

Do not attempt to relabel the former Helm release metadata or rename a live
PVC underneath an existing workload.

## Post-upgrade validation

- Sign in again and verify Admin, Manager, Browser, Portal, and optional Ceph
  Admin access.
- Reissue every API token and update its consumer.
- Verify access to every encrypted storage connection using the retained
  credential keyring.
- Exercise each recreated `klo-*` private access and administrative principal.
- Confirm there are no active migration policies with old or temporary SIDs.
- Confirm Portal logs are written to and readable from `klo-*` targets.
- Verify that deployed images, Helm resources, Compose project metadata,
  browser titles, and API metadata use Kaelo identifiers only.
- Re-enrol WebAuthn credentials only when the public domain or RP ID changed.

After validation, archive the inventories and backup evidence with the release
records. Do not reintroduce fallback parsing for the former identifiers.

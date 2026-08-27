# Local Quickstart

Use `./quickstart` to evaluate BucketReef from a clean macOS or Linux machine.
It is the shortest supported path to a secured administrator session; it is not
a production deployment recipe.

## What it starts

The quickstart uses the isolated Compose project `bucketreef-quickstart` and
builds, then starts only:

- the BucketReef backend with SQLite persistence;
- the BucketReef frontend on `http://localhost:8080`.

It does not start MinIO or any other storage simulator, configure an S3/Ceph
endpoint, or enable the scheduler. The frontend and backend bind to
`127.0.0.1` by default. Connecting existing object storage is optional after
the administrator and passkey are ready.

## Start

Requirements: Docker with Compose v2, OpenSSL and curl.

```bash
git clone https://github.com/ksperis/bucketreef.git
cd bucketreef
./quickstart
```

On first use the script creates `.env.quickstart` with mode `0600` and distinct
high-entropy values for the UI JWT ring, API JWT ring, credential-encryption
ring and internal scheduler token. It never overwrites `.env`.

The quickstart uses `docker-compose.build.yml`: it builds the current checkout
instead of pulling a possibly older published image. The first run can
therefore take several minutes; later runs reuse Docker's build cache.

Only after the backend health endpoint and the frontend setup route both answer
successfully does the script print a URL similar to:

```text
http://localhost:8080/setup/first-admin#token=...
```

Open it within 15 minutes. The page removes the fragment immediately, keeps the
token only in memory, creates the first super-administrator, and continues to
mandatory passkey enrollment without another password prompt. BucketReef is
ready for evaluation when passkey enrollment finishes and `/admin` opens.

If the link expires, run `./quickstart` again. The backend revokes the previous
token and prints a new one while the database has no users. Once a user exists,
the command prints the normal sign-in URL instead.

## Status and stop

```bash
./quickstart status
./quickstart stop
```

Both commands are idempotent. `stop` keeps the Compose volume and
`.env.quickstart`; the next `./quickstart` resumes the same installation.

## Reset with a verified backup

```bash
./quickstart reset
```

The reset proceeds only after the exact confirmation
`RESET BUCKETREEF QUICKSTART`. It then:

1. stops only the `bucketreef-quickstart` project;
2. copies `.env.quickstart` and the entire backend volume through a read-only
   mount into `.bucketreef-backups/<UTC timestamp>/`;
3. verifies that the volume archive is non-empty and readable and writes its
   manifest before deletion;
4. removes only the exact Compose-labelled backend volume;
5. preserves the non-secret bind, port, public-origin, WebAuthn, CORS and host
   configuration;
6. creates new secrets, rebuilds/restarts backend and frontend, verifies both,
   then prints a new bootstrap URL.

The volume archive contains the complete SQLite directory, including `app.db`
and any `app.db-wal` or `app.db-shm` files present after shutdown. The script
never calls `docker compose down --volumes` and never touches other Compose
projects or existing untracked backup files.

To restore a reset backup, stop the quickstart, resolve or create the exact
`bucketreef-quickstart` backend volume, then extract the archive into that empty
volume while retaining the saved `env.quickstart` as `.env.quickstart`. Do not
mix a database backup with different credential-encryption keys. Verify the
archive and target names before writing; see [Backup and restore](backup-restore.md)
for the production procedure.

## Custom ports or bind address

Set these variables before the first run so they are written to
`.env.quickstart`:

```bash
BUCKETREEF_FRONTEND_PORT=9080 \
BUCKETREEF_BACKEND_PORT=9000 \
./quickstart
```

`BUCKETREEF_BIND_ADDRESS` defaults to `127.0.0.1`. Listening on another address
is an explicit operator choice and requires coherent `PUBLIC_ORIGIN`, WebAuthn,
CORS, host and TLS configuration. Use the full deployment guide instead of
exposing the development profile directly.

A verified `reset` retains these non-secret network/origin values but rotates
all generated secrets. Edit `.env.quickstart` deliberately if you need to
change the configuration of an existing quickstart.

## From evaluation to a complete deployment

A complete Compose deployment uses strong externally managed secrets, a reverse
proxy with TLS, a suitable database and the operations profile:

```bash
export INTERNAL_CRON_TOKEN="$(openssl rand -hex 48)"
docker compose --profile operations up -d
```

Follow [Deploy with Docker Compose](deploy-docker-compose.md),
[Configuration](configuration.md), [Authentication security](authentication-hardening.md)
and [Production readiness](production-readiness.md). Do not copy quickstart
secrets into production.

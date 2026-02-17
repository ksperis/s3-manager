
# Run locally with Docker Compose

The repository includes `docker-compose.yml` for a local environment.

## Prerequisites

- Docker and Docker Compose
- A recent Node.js version (if you plan to run the frontend outside containers)

## Typical workflow

From the repository root:

```bash
docker compose up --build
```

Then open:

- Frontend: typically `http://localhost:8080`
- Backend API: typically `http://localhost:8000/api`
- OpenAPI: typically `http://localhost:8000/docs`

> Ports may vary depending on your compose configuration.  
> When in doubt, check `docker-compose.yml`.

## Built-in local scheduler (cron)

`docker-compose.yml` also starts a `scheduler` service that triggers:

- endpoint healthchecks every 5 minutes
- billing collection every day at 02:00 UTC (for `day-1`)

You can override schedules and token via `.env` in the repository root:

```bash
INTERNAL_CRON_TOKEN=change-me-strong
HEALTHCHECK_CRON_SCHEDULE=*/5 * * * *
BILLING_CRON_SCHEDULE=0 2 * * *
BILLING_DAY_OFFSET=1
```

`INTERNAL_CRON_TOKEN` must match between `backend` and `scheduler`.

## Default backend data

The backend uses SQLite by default and auto-seeds a super-admin (see `backend/README.md`):

- email: `admin@example.com`
- password: `changeme`

## Next steps

- Configure storage endpoints (Ceph RGW / MinIO) in the **Admin** surface
- Create/import an **S3 Account** (if your backend supports it) or add an **S3 Connection**

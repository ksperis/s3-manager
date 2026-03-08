# Deploy with Docker Compose

Use Docker Compose for quick local or validation deployments.

## Prebuilt images

```bash
mkdir s3-manager && cd s3-manager
wget https://raw.githubusercontent.com/ksperis/s3-manager/refs/heads/main/docker-compose.yml
S3_MANAGER_TAG=latest docker compose up
```

## Build from source

From repository root:

```bash
docker compose -f docker-compose.build.yml up --build
```

## Default endpoints

- Frontend: `http://localhost:8080`
- API base: `http://localhost:8000/api`
- OpenAPI: `http://localhost:8000/docs`

## Scheduler service

The compose stack includes a `scheduler` container that triggers:

- endpoint healthchecks (default every 5 minutes)
- billing daily collection (default `02:00 UTC`, day offset `1`)

Set a strong shared token in `.env`:

```bash
INTERNAL_CRON_TOKEN=change-me-strong
```

## Related pages

- [Configuration](configuration.md)
- [Operations: healthchecks](operations-healthchecks.md)
- [Operations: billing](operations-billing.md)

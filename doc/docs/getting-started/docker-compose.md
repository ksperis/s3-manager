
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

- Frontend: typically `http://localhost:5173`
- Backend API: typically `http://localhost:8000/api`
- OpenAPI: typically `http://localhost:8000/docs`

> Ports may vary depending on your compose configuration.  
> When in doubt, check `docker-compose.yml`.

## Default backend data

The backend uses SQLite by default and auto-seeds a super-admin (see `backend/README.md`):

- email: `admin@example.com`
- password: `changeme`

## Next steps

- Configure storage endpoints (Ceph RGW / MinIO) in the **Admin** surface
- Create/import an **S3 Account** (if your backend supports it) or add an **S3 Connection**

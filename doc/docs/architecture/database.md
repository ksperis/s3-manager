
# Database & migrations

## Default database

The backend uses SQLite by default (commonly `app.db`) for local development.

## Migrations

Migrations are managed by Alembic and are applied automatically at startup.

From `backend/`:

```bash
alembic upgrade head
alembic revision --autogenerate -m "describe change"
```

## Schema pointers

Schema and DB models can be found in:

- `backend/app/db/` (SQLAlchemy models)
- `backend/alembic/versions/` (migration history)

Notable entities:

- S3 Account: `backend/app/db/s3_account.py`
- S3 Connection: `backend/app/db/s3_connection.py`
- Storage endpoint: `backend/app/db/storage_endpoint.py`
- Audit: `backend/app/db/audit.py`

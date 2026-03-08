# Architecture: Database

## Defaults

- SQLite default for local runs (`app.db` or configured path).
- Alembic migrations under `backend/alembic/versions/`.

## Main model areas

- identities/users
- storage endpoints
- S3 accounts/users/connections
- audit and operational data
- bucket migration and health/billing data

## Operational note

Always apply schema migrations as part of deployment lifecycle.

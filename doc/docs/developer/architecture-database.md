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

## Schema diagrams

The database schema diagrams are generated from the SQLAlchemy metadata in
`backend/app/db`. The overview keeps all tables and foreign-key topology in a
single readable image; detailed slices show full column lists.

[![Database schema overview](../../assets/diagrams/database-schema/overview.svg)](../../assets/diagrams/database-schema/overview.svg)

### Detailed slices

<details>
  <summary>Identity and UI access</summary>
  <a href="../../assets/diagrams/database-schema/identity-ui-access.svg">
    <img src="../../assets/diagrams/database-schema/identity-ui-access.svg" alt="Identity and UI access database schema" loading="lazy">
  </a>
</details>

<details>
  <summary>Storage and S3 execution</summary>
  <a href="../../assets/diagrams/database-schema/storage-s3-execution.svg">
    <img src="../../assets/diagrams/database-schema/storage-s3-execution.svg" alt="Storage and S3 execution database schema" loading="lazy">
  </a>
</details>

<details>
  <summary>Tags and classification</summary>
  <a href="../../assets/diagrams/database-schema/tags-classification.svg">
    <img src="../../assets/diagrams/database-schema/tags-classification.svg" alt="Tags and classification database schema" loading="lazy">
  </a>
</details>

<details>
  <summary>Portal</summary>
  <a href="../../assets/diagrams/database-schema/portal.svg">
    <img src="../../assets/diagrams/database-schema/portal.svg" alt="Portal database schema" loading="lazy">
  </a>
</details>

<details>
  <summary>Operations and audit</summary>
  <a href="../../assets/diagrams/database-schema/operations-audit.svg">
    <img src="../../assets/diagrams/database-schema/operations-audit.svg" alt="Operations and audit database schema" loading="lazy">
  </a>
</details>

<details>
  <summary>Observability, quota, and billing</summary>
  <a href="../../assets/diagrams/database-schema/observability-quota-billing.svg">
    <img src="../../assets/diagrams/database-schema/observability-quota-billing.svg" alt="Observability quota and billing database schema" loading="lazy">
  </a>
</details>

<details>
  <summary>Full monolithic fallback</summary>
  <a href="../../assets/diagrams/database-schema/full.svg">
    <img src="../../assets/diagrams/database-schema/full.svg" alt="Full database schema" loading="lazy">
  </a>
</details>

## Operational note

Always apply schema migrations as part of deployment lifecycle.


# Overview

s3-manager consists of:

- a **FastAPI backend** (directory: `backend/`) exposing REST APIs under `/api`
- a **React + Vite frontend** (directory: `frontend/`) providing multiple UX “surfaces”
- optional deployment artifacts: **Docker Compose** (`docker-compose.yml`) and **Helm chart** (`helm/`)

## Surfaces

s3-manager is organized into distinct UX surfaces with different intents and capabilities:

- **Admin** (`/admin/*`): platform administration (storage endpoints, accounts, global settings, audit)
- **Manager** (`/manager/*`): account-scoped operations aligned with S3/IAM semantics
- **Browser** (`/browser/*`): credential-first, lightweight S3 browsing and bucket/object management
- **Portal** (`/portal/*`): optional managed workflows (enabled/disabled via settings)

See **Concepts → Surfaces** for the authoritative breakdown.

## Local-first posture

The repository includes:

- backend quickstart and demo seeding scripts (`backend/README.md`, `backend/app/scripts`)
- frontend quickstart (`frontend/README.md`)
- an integrated Docker Compose setup (`docker-compose.yml`) for local development

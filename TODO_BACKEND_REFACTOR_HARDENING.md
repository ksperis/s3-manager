# Backend Refactor And Hardening TODO

This file tracks the incremental cleanup, hardening, and refactor work for the
backend. It is intentionally scoped to internal structure and error handling:
public API routes, HTTP methods, response schemas, and authorization semantics
must remain stable unless a task explicitly says otherwise.

## Baseline Inventory

Generated with:

```bash
cd /Users/laurent/ksperis/s3-manager
rtk python3 backend/scripts/backend_refactor_inventory.py --largest-limit 15
```

- Python files under `backend/app`: 221
- Lines under `backend/app`: 72546
- Largest top-level areas:
  - `services`: 54 files, 38411 lines
  - `routers`: 76 files, 24050 lines
  - `models`: 40 files, 4724 lines
  - `db`: 21 files, 1687 lines
- Largest files:
  - `app/services/bucket_migration_service.py`: 6208 lines
  - `app/routers/ceph_admin/buckets.py`: 3830 lines
  - `app/services/portal_service.py`: 3654 lines
  - `app/services/browser_service.py`: 2820 lines
  - `app/routers/browser.py`: 2078 lines
  - `app/services/buckets_service.py`: 1926 lines
  - `app/services/s3_client.py`: 1754 lines
  - `app/routers/dependencies.py`: 1370 lines
- Hardening/refactor signals:
  - `detail=str(exc)`: 147 occurrences in 35 files
  - `message=str(exc)`: 16 occurrences in 4 files
  - `except Exception as exc`: 95 occurrences in 29 files
  - `raise HTTPException`: 537 occurrences in 57 files
  - `record_action`: 174 occurrences in 29 files
- DB/API model filename overlaps: 15 names
  - `api_token`, `audit`, `billing`, `bucket_migration`, `bucket_usage_stats`,
    `healthcheck`, `oidc`, `portal`, `s3_account`, `s3_connection`, `s3_user`,
    `session`, `storage_endpoint`, `ui_group`, `user`

## Guiding Constraints

- Keep routers thin, then services, then clients.
- Preserve the strict separation between S3 accounts and S3 connections.
- Do not create a parallel permission model; IAM/S3 remains the source of truth.
- Mutating operations must keep explicit execution identity and audit metadata.
- Error hardening may reduce client-visible internals, but must preserve useful
  server-side logs and stable status codes.

## Incremental Work Items

| ID | Status | Risk | Area | Target | Validation |
| --- | --- | --- | --- | --- | --- |
| BE-HARD-001 | Done | Low | Inventory | Add reproducible backend refactor inventory script and this tracking file. | Run `backend/scripts/backend_refactor_inventory.py`. |
| BE-HARD-002 | Done | Low | Error handling | Consolidate `RuntimeError`/`ValueError` to HTTPException mapping through `app/routers/http_errors.py`; first slice applied to `manager/topics.py` and the shared bucket config action seam. | `backend/tests/test_http_errors.py`; full backend pytest. |
| BE-HARD-003 | Todo | Medium | Error handling | Continue replacing risky `detail=str(exc)` and `message=str(exc)` exposures in routers, prioritizing Ceph Admin users/accounts, Manager IAM, auth, and migrations. | Per-router tests plus full backend pytest. |
| BE-HARD-004 | Todo | Medium | SSE errors | Re-audit stream handlers and long-running tools so unexpected failures send generic client errors while logs retain sanitized context. | Stream tests for Browser, Ceph Admin, Storage Ops, migration, purge, integrity. |
| BE-AUDIT-001 | Todo | Medium | Audit | Build and review a mutating-route audit matrix; confirm actor, scope, action, entity, account context, and executor/workflow identifiers where relevant. | Static matrix plus targeted route tests. |
| BE-BUCKET-001 | Todo | Medium | Bucket config | Extend the shared bucket config action seam so Manager, Browser, Storage Ops, and Ceph Admin reuse the same error/audit mapping where contracts are identical. | Bucket config tests and route snapshot before/after. |
| BE-DEPS-001 | Todo | Medium | Dependencies | Split `routers/dependencies.py` into internal modules for auth/session, account context, portal access, feature gates, SSE-C, and Ceph Admin context; keep re-exports stable. | Import compatibility test plus full backend pytest. |
| BE-SVC-001 | Todo | High | Migration service | Split `bucket_migration_service.py` into planning, execution, progress, rollback, persistence, and worker orchestration modules without changing migration semantics. | `backend/tests/test_bucket_migration_service.py` and functional Ceph runner when lab env is available. |
| BE-SVC-002 | Todo | Medium | Portal service | Split `portal_service.py` into storage spaces, access keys, object access, activity/audit, and public-link flows. | `backend/tests/test_portal_service.py`. |
| BE-SVC-003 | Todo | Medium | Browser service | Split `browser_service.py` into context resolution, listing/search, object operations, transfer helpers, and SQLite cache helpers. | Browser service tests and route smoke tests. |
| BE-MODEL-001 | Todo | Medium | DB/API mapping | Add targeted mapper helpers for repeated SQLAlchemy-to-Pydantic conversions; keep DB and API models separate. | Model/service tests for each converted area. |
| BE-CLEAN-001 | Todo | Low | Dead code | Remove only code confirmed by `backend/scripts/check_vulture.py`, updating allowlist only when a dynamic entry is intentionally retained. | `python scripts/check_vulture.py`. |

## Route Audit Hotspots

The inventory currently reports the largest mutating-route surfaces as:

| File | Routes | Mutating routes | `record_action` calls |
| --- | ---: | ---: | ---: |
| `app/routers/browser.py` | 87 | 52 | 0 |
| `app/routers/manager/buckets.py` | 44 | 28 | 27 |
| `app/routers/ceph_admin/buckets.py` | 43 | 27 | 0 |
| `app/routers/manager/migrations.py` | 17 | 14 | 14 |
| `app/routers/portal.py` | 33 | 12 | 15 |
| `app/routers/auth.py` | 13 | 10 | 13 |
| `app/routers/manager/iam_users.py` | 13 | 9 | 9 |

Notes:

- Browser and Ceph Admin mutation counts need manual interpretation because
  some operations delegate audit recording to shared helpers or specialized
  services. Do not infer missing audit only from the static count.
- Ceph Admin remains an admin-only operational surface; keep it separate from
  Manager and Browser even when bucket helper code is shared.
- Portal wording and contracts must remain end-user scoped and must not leak
  Manager/Ceph Admin vocabulary.

## Validation Checklist For Each Lot

- Run targeted tests for touched files.
- Run:

```bash
cd /Users/laurent/ksperis/s3-manager/backend
PYTHONPATH=. python -m pytest tests -q
python scripts/check_vulture.py
```

- Run `backend/tests_ceph_functional/run_ci.py` only for changes that touch real
  RGW/S3 behavior and only when lab credentials are available.
- If committing, use the AI Conventional Commit body required by
  `doc/docs/developer/ai-assistant-guidelines.md`.

## Validation Evidence

- 2026-06-25: `PYTHONPATH=. .venv/bin/pytest tests/test_http_errors.py tests/test_backend_refactor_inventory.py tests/test_bucket_config_actions.py -q` -> 8 passed.
- 2026-06-25: `PYTHONPATH=. .venv/bin/pytest tests -q` -> 1117 passed.
- 2026-06-25: `python scripts/check_vulture.py` -> passed.
- 2026-06-25: `git diff --check` -> passed.

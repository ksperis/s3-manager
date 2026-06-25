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
- Lines under `backend/app`: 72549
- Largest top-level areas:
  - `services`: 54 files, 38421 lines
  - `routers`: 76 files, 24043 lines
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
  - `detail=str(exc)`: 63 occurrences in 28 files
  - `message=str(exc)`: 16 occurrences in 4 files
  - `except Exception as exc`: 95 occurrences in 29 files
  - `raise HTTPException`: 451 occurrences in 55 files
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
| BE-HARD-003 | Done | Medium | Error handling | Continue replacing risky `detail=str(exc)` and `message=str(exc)` exposures in routers, prioritizing Ceph Admin users/accounts, Manager IAM, auth, and migrations. | Per-router tests plus full backend pytest. |
| BE-HARD-004 | Done | Medium | SSE errors | Re-audit stream handlers and long-running tools so unexpected failures send generic client errors while logs retain sanitized context. | Stream tests for Browser, Ceph Admin, Storage Ops, migration, purge, integrity. |
| BE-AUDIT-001 | Done | Medium | Audit | Build and review a mutating-route audit matrix; confirm actor, scope, action, entity, account context, and executor/workflow identifiers where relevant. | Static matrix plus targeted route tests. |
| BE-BUCKET-001 | Done | Medium | Bucket config | Ceph Admin bucket configuration routes now delegate to the shared bucket config action seam for properties, versioning, lifecycle, CORS, policy, notifications, replication, logging, website, tags, ACL, public access block, object lock, and encryption. Feature gates and cache invalidation remain route-owned. | Bucket config and Ceph Admin route tests passed; full backend validation passed. |
| BE-DEPS-001 | Done | Medium | Dependencies | Split `routers/dependencies.py` into internal modules for auth/session, account context, portal access, feature gates, SSE-C, Ceph Admin context, audit, and shared dependency types; keep re-exports stable. | Import compatibility test plus full backend pytest. |
| BE-SVC-001 | Done | High | Migration service | Split `bucket_migration_service.py` into a public facade plus internal shared, persistence, planning, execution, progress, rollback, webhook, and worker modules without changing migration semantics. | `backend/tests/test_bucket_migration_service.py` and full backend pytest passed; functional Ceph runner unchanged/not run without lab requirement. |
| BE-SVC-002 | Done | Medium | Portal service | Split `portal_service.py` into a public facade plus settings, IAM/policy, storage spaces, object access, sharing/public-link, activity/audit, state/usage, access-key, and bucket/user modules. | `backend/tests/test_portal_service.py` and full backend pytest passed. |
| BE-SVC-003 | Done | Medium | Browser service | Split `browser_service.py` into a public facade plus shared cache/types, context/STS/CORS, transfer, bucket, listing/search, version cleanup, object detail, and object operation modules. | Browser service and route smoke tests passed; full backend pytest passed. |
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

## Mutating Route Audit Matrix

Generated with:

```bash
cd /Users/laurent/ksperis/s3-manager
rtk python3 backend/scripts/backend_audit_matrix.py
```

- Mutating routes: 262
- Routes with direct `record_action`: 135
- Routes with delegated audit/stream signal: 44
- Routes without static audit signal: 68

Interpretation notes:

- The matrix is a static review aid; a route without a direct signal may still
  be intentionally unaudited, read-like despite POST semantics, internal-only,
  or audited in a called service.
- The largest manual-review clusters are Ceph Admin bucket configuration routes,
  usage-stat streams, credential validation endpoints, cache refresh endpoints,
  and legacy Browser tombstone routes.
- Do not add audit events blindly. For each candidate, first classify whether
  the route is mutating, operational read/refresh, internal cron, validation
  probe, delegated stream, or legacy compatibility surface.

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
- 2026-06-25: BE-HARD-003 targeted tests `PYTHONPATH=. .venv/bin/pytest tests/test_http_errors.py tests/test_auth_ldap.py tests/test_api_tokens.py tests/test_manager_ceph_keys_router.py tests/test_ceph_admin_accounts_listing.py tests/test_ceph_admin_users_listing.py tests/test_bucket_migration_service.py -q` -> 144 passed.
- 2026-06-25: BE-HARD-003 full validation `PYTHONPATH=. .venv/bin/pytest tests -q` -> 1123 passed; `python scripts/check_vulture.py` -> passed; `git diff --check` -> passed.
- 2026-06-25: BE-HARD-004 targeted stream tests `PYTHONPATH=. .venv/bin/pytest tests/test_bucket_integrity_routes.py tests/test_bucket_purge_routes.py tests/test_storage_ops_buckets.py tests/test_ceph_admin_buckets_cache.py tests/test_manager_migrations_stream.py tests/test_http_errors.py -q` -> 137 passed.
- 2026-06-25: BE-HARD-004 full validation `PYTHONPATH=. .venv/bin/pytest tests -q` -> 1125 passed; `python scripts/check_vulture.py` -> passed; `git diff --check` -> passed.
- 2026-06-25: BE-AUDIT-001 targeted tests `PYTHONPATH=. .venv/bin/pytest tests/test_backend_audit_matrix.py -q` -> 2 passed.
- 2026-06-25: BE-AUDIT-001 full validation `PYTHONPATH=. .venv/bin/pytest tests -q` -> 1127 passed; `python scripts/check_vulture.py` -> passed; `git diff --check` -> passed.
- 2026-06-25: BE-BUCKET-001 targeted tests `PYTHONPATH=. .venv/bin/pytest tests/test_ceph_admin_buckets_cache.py tests/test_bucket_replication.py tests/test_ceph_admin_feature_flags_enforcement.py tests/test_bucket_config_actions.py -q` -> 87 passed.
- 2026-06-25: BE-BUCKET-001 full validation `PYTHONPATH=. .venv/bin/pytest tests -q` -> 1127 passed; `python scripts/check_vulture.py` -> passed; `git diff --check` -> passed.
- 2026-06-25: BE-DEPS-001 targeted tests `PYTHONPATH=. .venv/bin/pytest tests/test_dependencies_facade.py tests/test_internal_token_dependency.py tests/test_internal_usage_history.py tests/test_browser_sse_customer_dependency.py tests/test_manager_migrations_permissions.py tests/test_manager_workspace_access_rules.py tests/test_admin_ui_groups.py tests/test_storage_ops_buckets.py -q` -> 123 passed.
- 2026-06-25: BE-DEPS-001 full validation `PYTHONPATH=. .venv/bin/pytest tests -q` -> 1129 passed; `python scripts/check_vulture.py` -> passed; `git diff --check` -> passed.
- 2026-06-25: BE-SVC-001 targeted tests `PYTHONPATH=. .venv/bin/pytest tests/test_bucket_migration_service.py -q` -> 89 passed.
- 2026-06-25: BE-SVC-001 full validation `PYTHONPATH=. .venv/bin/pytest tests -q` -> 1129 passed; `python scripts/check_vulture.py` -> passed; `git diff --check` -> passed.
- 2026-06-25: BE-SVC-002 targeted tests `PYTHONPATH=. .venv/bin/pytest tests/test_portal_service.py -q` -> 64 passed.
- 2026-06-25: BE-SVC-002 full validation `PYTHONPATH=. .venv/bin/pytest tests -q` -> 1129 passed; `python scripts/check_vulture.py` -> passed; `git diff --check` -> passed.
- 2026-06-25: BE-SVC-003 targeted tests `PYTHONPATH=. .venv/bin/pytest tests/test_browser_download_endpoint.py tests/test_browser_object_tags_endpoint.py tests/test_browser_object_columns_endpoint.py tests/test_browser_buckets_search_endpoint.py tests/test_browser_service_search.py tests/test_browser_service_sts.py tests/test_browser_service_sse_customer.py tests/test_browser_cleanup_versions.py tests/test_browser_buckets_cache.py tests/test_browser_object_lock.py -q` -> 47 passed.
- 2026-06-25: BE-SVC-003 full validation `PYTHONPATH=. .venv/bin/pytest tests -q` -> 1129 passed; `python scripts/check_vulture.py` -> passed; `git diff --check` -> passed.

# Ceph Functional Test Suite

This suite exercises the FastAPI backend against a *real* Ceph RGW cluster to validate
critical account, bucket, IAM and object workflows after Ceph upgrades. The tests are
marked `ceph_functional` and excluded from the default `pytest` run (`-m "not ceph_functional"`).
In GitLab CI the suite starts an ephemeral backend inside the job and points it at the
lab RGW endpoint via `ENV_STORAGE_ENDPOINTS`.

## Prerequisites

1. A running instance of the backend API reachable from your workstation.
2. Credentials for a super admin user on that instance.
3. (Optional) RGW Admin API credentials to double-check the Ceph state directly.

Export the following environment variables before running the suite.
For local one-shot runs, `backend/.env` is loaded automatically and seed variables
(`SEED_*`) are used as fallback for missing `CEPH_TEST_*` values.

| Variable | Required | Description |
| --- | --- | --- |
| `CEPH_TEST_BACKEND_BASE_URL` | ✅ | Base URL including the API prefix (e.g. `https://manager.example.com/api`). |
| `CEPH_TEST_SUPERADMIN_EMAIL` | ✅ | Login of the backend super admin user. |
| `CEPH_TEST_SUPERADMIN_PASSWORD` | ✅ | Password for the super admin user. |
| `CEPH_TEST_VERIFY_TLS` | | Set to `true` to validate HTTPS certificates. |
| `CEPH_TEST_BACKEND_CA_BUNDLE` | | Path to a CA bundle when using a custom PKI. |
| `CEPH_TEST_RESOURCE_PREFIX` | | Prefix used for accounts/buckets created during the run (`ceph-functional` by default). |
| `CEPH_TEST_DELETE_RGW_TENANT` | | Whether teardown should remove the RGW tenant (default `false`). |
| `CEPH_TEST_RGW_ADMIN_ENDPOINT` | | RGW admin endpoint for direct Ceph checks. |
| `CEPH_TEST_RGW_ADMIN_ACCESS_KEY` / `CEPH_TEST_RGW_ADMIN_SECRET_KEY` | | Credentials for the RGW admin API. |
| `CEPH_TEST_RGW_REGION` | | Region for AWS SigV4 signing (defaults to backend config). |
| `CEPH_TEST_RGW_VERIFY_TLS` / `CEPH_TEST_RGW_CA_BUNDLE` | | TLS options for RGW admin calls. |
| `CEPH_TEST_CEPH_ADMIN_ENDPOINT_NAME` | | Optional endpoint name override for ceph-admin tests. |
| `CEPH_TEST_CEPH_ADMIN_REQUIRE_DEFAULT_ENDPOINT` | | Require an endpoint flagged as default (default `true`). |

## GitLab CI variables

The `ceph-functional-tests` job now starts a local backend inside the GitLab job, using
SQLite plus `ENV_STORAGE_ENDPOINTS` to register the lab Ceph endpoint as the default
endpoint. This avoids the current limitation of the seed-based default endpoint flow,
which always creates the endpoint with `verify_tls=true`.

The GitLab runner must be able to reach:

- the lab S3 endpoint
- the RGW admin endpoint

Required GitLab variables:

- `CEPH_TEST_LAB_S3_ENDPOINT`
- `CEPH_TEST_RGW_ADMIN_ENDPOINT`
- `CEPH_TEST_RGW_ADMIN_ACCESS_KEY`
- `CEPH_TEST_RGW_ADMIN_SECRET_KEY`
- `CEPH_TEST_SUPERVISION_ACCESS_KEY`
- `CEPH_TEST_SUPERVISION_SECRET_KEY`
- `CEPH_TEST_CEPH_ADMIN_ACCESS_KEY`
- `CEPH_TEST_CEPH_ADMIN_SECRET_KEY`

Recommended GitLab variables:

- `CEPH_TEST_RGW_REGION` (defaults to `us-east-1`)
- `CEPH_TEST_LAB_VERIFY_TLS=true`
- `CEPH_TEST_RGW_VERIFY_TLS=true`
- `CEPH_TEST_RGW_CA_BUNDLE`
- `CEPH_TEST_RESOURCE_PREFIX`
- `CEPH_TEST_HTTP_TIMEOUT`
- `CEPH_TEST_LOGIN_RETRIES`
- `CEPH_TEST_LOGIN_RETRY_DELAY`

GitLab variable handling:

- mark the RGW, supervision, and ceph-admin credentials as `masked` and `protected`
- if direct RGW verification needs a custom PKI, define `CEPH_TEST_RGW_CA_BUNDLE` as a
  GitLab file variable

For manual or exceptional runs against an already deployed backend, `tests_ceph_functional/run.py`
still supports the original external-backend mode with:

- `CEPH_TEST_BACKEND_BASE_URL`
- `CEPH_TEST_SUPERADMIN_EMAIL`
- `CEPH_TEST_SUPERADMIN_PASSWORD`

## Running the tests

From the repository root:

```bash
export CEPH_TEST_BACKEND_BASE_URL="https://manager.example.com/api"
export CEPH_TEST_SUPERADMIN_EMAIL="admin@example.com"
export CEPH_TEST_SUPERADMIN_PASSWORD="your-secret"

PYTHONPATH=backend \
  pytest backend/tests_ceph_functional -m ceph_functional
```

or use the helper script:

```bash
python backend/tests_ceph_functional/run.py
```

To run only the live bucket migration scenarios:

```bash
PYTHONPATH=backend \
  pytest backend/tests_ceph_functional/test_bucket_migration_flow.py -m ceph_functional
```

A summary table is displayed at the end of the run along with any cleanup issues.
All resources created during a test are tracked and deleted automatically, even when tests fail.
Ceph-admin entity creation tests are executed only when RGW admin cleanup credentials are available.

## Current scenarios

- **S3Account/Bucket/Object flow**: creates a tenant, manager, bucket, uploads/downloads objects, manages policies/tags, then exercises admin teardown.
- **Bucket configuration**: validates Manager bucket round-trips for versioning, lifecycle, CORS, tags, policy and public access block, plus dedicated logging/website/quota/notifications/replication scenarios when the cluster supports them.
- **IAM & policies**: provisions IAM users/keys, creates managed policies, attaches them to users, and exercises key/user deletion.
- **Stats & traffic**: hits `/manager/stats/overview` and `/manager/stats/traffic` after generating activity, skipping gracefully when RGW usage logs are unavailable.
- **Bucket migration**: exercises one-shot and pre-sync migrations for current-only and version-aware buckets, validates replicated object state through the backend API, and requires the migration worker to be enabled on the target backend.
- **Ceph-admin endpoints & metrics**: validates endpoint discovery, access probes, info, cluster storage and traffic metrics routes.
- **Ceph-admin accounts**: validates listing/search/detail/update/metrics against dedicated RGW test accounts.
- **Ceph-admin users**: validates listing/search/detail/config/caps/quota/key lifecycle/metrics on dedicated RGW test users.
- **Ceph-admin bucket administration**: validates bucket listing, compare and configuration routes (versioning, lifecycle, CORS, policy, tags, ACL, PAB, object-lock, quota, notifications, replication, logging, website, encryption) on dedicated test buckets.

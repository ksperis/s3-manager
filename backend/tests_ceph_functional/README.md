# Ceph Functional Test Suite

This suite exercises the FastAPI backend against a *real* Ceph RGW cluster to validate
critical account, bucket, IAM and object workflows after Ceph upgrades. The tests are
run manually and are not part of the CI pipeline. They are marked `ceph_functional`
and excluded from the default `pytest` run (`-m "not ceph_functional"`).

## Prerequisites

1. A running instance of the backend API reachable from your workstation.
2. Credentials for a super admin user on that instance.
3. (Optional) RGW Admin API credentials to double-check the Ceph state directly.

Export the following environment variables before running the suite:

| Variable | Required | Description |
| --- | --- | --- |
| `CEPH_TEST_BACKEND_BASE_URL` | ✅ | Base URL including the API prefix (e.g. `https://manager.example.com/api`). |
| `CEPH_TEST_SUPERADMIN_EMAIL` | ✅ | Login of the backend super admin user. |
| `CEPH_TEST_SUPERADMIN_PASSWORD` | ✅ | Password for the super admin user. |
| `CEPH_TEST_VERIFY_TLS` | | Set to `true` to validate HTTPS certificates. |
| `CEPH_TEST_BACKEND_CA_BUNDLE` | | Path to a CA bundle when using a custom PKI. |
| `CEPH_TEST_RESOURCE_PREFIX` | | Prefix used for accounts/buckets created during the run (`ceph-functional` by default). |
| `CEPH_TEST_DELETE_RGW_TENANT` | | Whether teardown should remove the RGW tenant (default `true`). |
| `CEPH_TEST_RGW_ADMIN_ENDPOINT` | | RGW admin endpoint for direct Ceph checks. |
| `CEPH_TEST_RGW_ADMIN_ACCESS_KEY` / `CEPH_TEST_RGW_ADMIN_SECRET_KEY` | | Credentials for the RGW admin API. |
| `CEPH_TEST_RGW_REGION` | | Region for AWS SigV4 signing (defaults to backend config). |
| `CEPH_TEST_RGW_VERIFY_TLS` / `CEPH_TEST_RGW_CA_BUNDLE` | | TLS options for RGW admin calls. |

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

A summary table is displayed at the end of the run along with any cleanup issues. All
resources created during a test are tracked and deleted automatically, even when tests fail.

## Current scenarios

- **S3Account/Bucket/Object flow**: creates a tenant, manager, bucket, uploads/downloads objects, manages policies/tags, then exercises admin teardown.
- **Bucket configuration**: validates lifecycle, CORS and per-bucket quotas (Super Admin safeguarded route included).
- **IAM & policies**: provisions IAM users/keys, creates managed policies, attaches them to users, and exercises key/user deletion.
- **Stats & traffic**: hits `/manager/stats/overview` and `/manager/stats/traffic` after generating activity, skipping gracefully when RGW usage logs are unavailable.

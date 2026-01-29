
# S3 Accounts

An **S3 Account** is a *platform* concept that represents an administrative tenant on a storage backend.

In Ceph RGW (Squid/Tentacle and later), this aligns with the **RGW Accounts** model (account + root user),
and is used to manage:

- account-wide quotas and usage
- IAM resources (users, roles, policies)
- administrative workflows (portal onboarding, managed controls)

## Why Accounts exist

Accounts enable:

- clean tenant boundaries
- predictable ownership and billing/quotas
- IAM governance consistent with S3 semantics

## Where it is used in s3-manager

- Admin: create/import/manage accounts, quotas, account-level stats
- Manager: operate inside an execution context (buckets, IAM, policies)
- Portal: target scope for managed workflows (portal context)

## Portal eligibility

S3 Accounts are the only portal-eligible contexts. The portal selects an **account scope**
but never uses that scope as execution credentials.

## Data model pointers

See backend models:

- DB: `backend/app/db/s3_account.py`
- Pydantic models: `backend/app/models/s3_account.py`

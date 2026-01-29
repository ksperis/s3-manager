
# Surfaces (Admin / Manager / Browser / Portal)

s3-manager exposes multiple user experiences (“surfaces”). They share a common backend but differ in intent,
capabilities, and required inputs.

Access is primarily driven by UI roles (`ui_admin`, `ui_user`, `ui_none`) and per-account links
(`account_role`, `account_admin`). See **Concepts → Identity model** for the full mapping.

## Admin (`/admin/*`)

Target audience: platform administrators.

Typical responsibilities:

- manage **storage endpoints** (Ceph RGW / MinIO / other S3 backends)
- manage **S3 Accounts** (Ceph RGW Accounts model) and administrative users
- manage global settings and feature toggles
- review **audit** and global statistics

## Manager (`/manager/*`)

Target audience: account administrators and advanced users.

Typical responsibilities:

- operate within an **execution context** (account / connection / legacy user)
- manage S3 resources aligned with S3/IAM semantics:
  - buckets, objects, lifecycle, versioning, object lock (when supported)
  - IAM users, groups, roles, policies

## Browser (`/browser/*`)

Target audience: credential holders (access key / secret key), “S3 Browser”-like usage.

Characteristics:

- works in a **credential-first** manner
- focuses on bucket listing, object browsing, uploads/downloads, and basic bucket settings
- avoids requiring knowledge of “Accounts” or platform concepts
- uses the same **execution context** selection as `/manager`

## Portal (`/portal/*`) (optional)

Target audience: end users needing guided workflows.

Characteristics:

- uses a **portal context** (target account scope) for workflows
- provides managed flows that may involve:
  - request/approval patterns (future)
  - “golden path” configurations
  - simplified onboarding for a given organization

The Portal surface is enabled/disabled on the backend via feature flags (see `backend/app/main.py` dependencies).

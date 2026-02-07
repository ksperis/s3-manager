# Ceph Admin surface

The Ceph Admin surface provides cluster-level RGW administration from the UI.

## Scope

- Endpoint-scoped administration (no account execution context)
- RGW Admin Ops + S3 bucket configuration for the selected Ceph endpoint
- Initial objects supported:
  - RGW Accounts
  - RGW Users
  - Buckets and bucket configuration

## Access and prerequisites

- UI role must be `ui_admin`
- Global feature flag `ceph_admin_enabled` must be enabled
- At least one Ceph storage endpoint with Admin capability enabled

## Endpoint selection

When multiple Ceph endpoints are available:

- A selector is displayed in the top bar on `/ceph-admin/*`
- The selected endpoint is persisted in:
  - URL query param: `ep`
  - local storage key: `selectedCephAdminEndpointId`
- The active endpoint drives all lists and detail actions (accounts, users, buckets)

## Lists behavior

Accounts and Users lists now follow the same interaction model as other inventory pages:

- Backend-side filtering (`search`)
- Backend-side pagination (`page`, `page_size`)
- Lazy loading by page
- Unified table + pager UI style

## Buckets behavior

- Bucket listing supports backend pagination, filtering, sorting, and optional feature enrichment
- Bucket detail is shared with manager-style UX, in `ceph-admin` mode
- Available configuration includes:
  - versioning, object lock, lifecycle, ACL, policy, CORS, public access block
  - static website
  - access logging
  - notifications

## Implementation pointers

Backend routers:

- `backend/app/routers/ceph_admin/endpoints.py`
- `backend/app/routers/ceph_admin/accounts.py`
- `backend/app/routers/ceph_admin/users.py`
- `backend/app/routers/ceph_admin/buckets.py`

Frontend routes:

- `/ceph-admin/*`

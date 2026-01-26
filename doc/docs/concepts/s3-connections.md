
# S3 Connections

An **S3 Connection** is a **credential-first** configuration that allows s3-manager to talk to an S3 endpoint.

It typically includes:

- endpoint URL
- access key / secret key (and optional session token)
- region / signature settings (backend-dependent)
- optional “connection label” for UI selection

## Why Connections exist

Connections enable:

- a lightweight “S3 Browser” experience without requiring platform-level account creation
- compatibility with backends that do not implement a full Accounts model
- per-user separation of credentials (UI identity != storage credentials)

## Surfaces using S3 Connections

- Browser: uses an S3 Connection directly
- Manager: may use an S3 Connection as an execution mechanism (depending on your design)
- Admin: manages the list of available connections and who can use them

## Data model pointers

See backend models:

- DB: `backend/app/db/s3_connection.py`
- Admin-facing schema: `backend/app/models/s3_connection_admin.py`

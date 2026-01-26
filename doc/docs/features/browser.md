
# Browser surface

The Browser surface is the “credential-first” experience.

## Intended usage

- You have an S3 endpoint and access keys
- You want an S3 console to browse buckets/objects and perform basic operations
- You do **not** want (or do not have) platform-level account administration

## Typical capabilities

- list buckets
- browse objects and prefixes
- upload/download
- basic bucket settings (capability depends on backend)

## Notes

This surface should remain lightweight and predictable, similar to classic S3 desktop clients,
while still benefiting from s3-manager’s centralized UI authentication (when applicable).

Frontend routes:

- `/browser/*`

Backend routers include:

- `backend/app/routers/browser.py`

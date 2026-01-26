
# S3 Connection lifecycle

An S3 Connection represents externally-managed credentials.

## Creation

Connections are typically created by:

- Admins (shared connections)
- End users (personal connections)

Required information:

- endpoint URL
- access key
- secret key
- optional region / signature options

## Validation

Upon creation, s3-manager should:

- attempt a lightweight API call (e.g. `ListBuckets`)
- record detected capabilities (best-effort)

## Usage

Connections are primarily used by:

- Browser surface
- Some Manager workflows (depending on design)

Connections are **not assumed** to have IAM admin rights.

## Rotation

Credential rotation is external by nature.

Recommended practice:

- create a new connection
- validate it
- switch usage
- delete the old one

This avoids hidden downtime.

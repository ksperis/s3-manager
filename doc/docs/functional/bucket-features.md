
# Bucket features

This section describes how s3-manager exposes bucket-level features.

## Versioning

- Exposed when backend supports S3 versioning
- UI reflects actual backend state
- No attempt to “fix” invalid transitions

## Object Lock

- Only exposed when versioning is enabled
- Backend capability detection is critical
- Legal hold and retention are explicit actions

## Lifecycle rules

- Represented as native S3 lifecycle configurations
- UI edits translate directly to lifecycle JSON
- No proprietary abstraction layer

## Access control

Depending on backend:

- bucket policies
- ACLs (legacy / compatibility)
- block-public-access–style controls

s3-manager favors **policy-based access** over ACLs.

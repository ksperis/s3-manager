
# Ceph RGW

Ceph RGW is a first-class target for s3-manager, especially for versions implementing the
**Accounts** model (Squid/Tentacle and later).

## What s3-manager may use

Depending on your configuration and features, s3-manager may interact with:

- S3 APIs (buckets, objects, lifecycle, versioning, object lock)
- IAM APIs (users, groups, roles, policies)
- RGW Admin Ops APIs (account administration, quotas, stats)

## Version notes

Ceph RGW features vary significantly across releases and distributions.
If you support multiple clusters/versions, document:

- which features are expected to work on each cluster
- which limitations are accepted (known gaps)

## Operational notes

Ceph RGW is a distributed system; for production usage consider:

- multisite implications (realms, zonegroups, zones)
- versioning and lifecycle shard scaling
- audit/log collection strategies

This documentation intentionally stays high-level. For deeper operational notes,
extend this section with your organization’s Ceph standards.

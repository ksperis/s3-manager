
# Compatibility matrix

s3-manager is designed for **S3-compatible** backends, with deeper integration for Ceph RGW.

This page documents capabilities at a high level. Treat this as guidance; the authoritative truth is
the behavior observed on your target backend and version.

| Capability | S3 API | IAM API | Admin API | Notes |
|---|---:|---:|---:|---|
| Bucket list / object browse | Yes | N/A | N/A | Baseline Browser capabilities |
| Bucket versioning | Yes | N/A | N/A | Some backends differ in edge cases |
| Object Lock | Yes | N/A | N/A | Requires backend support + versioning |
| Lifecycle | Yes | N/A | N/A | Implementation differences exist |
| IAM users / roles / policies | N/A | Yes | N/A | Not all “S3-compatible” products implement IAM fully |
| Accounts model | N/A | Yes | Yes | Ceph RGW Squid/Tentacle and later |

Next pages provide backend-specific notes.

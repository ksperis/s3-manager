# Backends: Compatibility Matrix

s3-manager targets S3-compatible backends, with deeper integration for Ceph RGW.

| Capability | S3 API | IAM API | Admin API | Notes |
|---|---:|---:|---:|---|
| Bucket/object browsing | Yes | N/A | N/A | Baseline browser capability |
| Bucket versioning | Yes | N/A | N/A | Backend-specific edge cases may differ |
| Object lock | Yes | N/A | N/A | Requires backend support |
| Lifecycle | Yes | N/A | N/A | Behavior can vary across providers |
| IAM users/roles/policies | N/A | Yes | N/A | Not universal among S3-compatible products |
| Accounts model | N/A | Yes | Yes | Strongly aligned with Ceph RGW modern accounts |

## Related pages

- [Backends: Ceph RGW](backends-ceph-rgw.md)
- [Backends: Other S3 implementations](backends-others.md)

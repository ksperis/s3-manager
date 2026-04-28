# Backends: Compatibility Matrix

s3-manager targets S3-compatible backends, with deeper integration for Ceph RGW and a dedicated AWS preset.

| Capability | S3 API | IAM API | Admin API | Notes |
|---|---:|---:|---:|---|
| Bucket/object browsing | Yes | N/A | N/A | Baseline browser capability |
| Bucket versioning | Yes | N/A | N/A | Backend-specific edge cases may differ |
| Object lock | Yes | N/A | N/A | Requires backend support |
| Lifecycle | Yes | N/A | N/A | Behavior can vary across providers |
| IAM users/roles/policies | N/A | Yes | N/A | Not universal among S3-compatible products |
| Accounts model | N/A | Yes | Yes | Strongly aligned with Ceph RGW modern accounts |

## AWS preset

The AWS storage endpoint type preconfigures regional endpoints from the selected region. With the default `us-east-1` region, it uses:

- S3 endpoint: `https://s3.us-east-1.amazonaws.com`
- STS endpoint: `https://sts.us-east-1.amazonaws.com`
- IAM endpoint: `https://iam.amazonaws.com`
- Default region: `us-east-1`

For AWS commercial regions, IAM remains the official global commercial endpoint and IAM requests are signed with `us-east-1`, even when S3 and STS use the selected region. In the admin UI, the AWS preset exposes the region as the editable choice and derives S3, STS, and IAM endpoints automatically. Use the **Other** provider type for custom endpoints or proxies.

AWS endpoints keep Ceph-only capabilities disabled: Admin Ops, account API, usage logs, RGW metrics, and RGW SNS topics.

## Related pages

- [Backends: Ceph RGW](backends-ceph-rgw.md)
- [Backends: Other S3 implementations](backends-others.md)

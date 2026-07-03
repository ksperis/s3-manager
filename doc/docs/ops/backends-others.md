# Backends: Other S3 Implementations

s3-manager can integrate with non-Ceph S3-compatible backends such as AWS S3 and MinIO.

## AWS

Use the dedicated **AWS** endpoint type when targeting native Amazon S3. It preconfigures regional S3 and STS endpoints from the selected region:

- `https://s3.us-east-1.amazonaws.com` for S3 with the default `us-east-1` region
- `https://sts.us-east-1.amazonaws.com` for STS with the default `us-east-1` region
- `https://iam.amazonaws.com` for IAM
- `us-east-1` as the default region

For AWS commercial regions, IAM remains the official global commercial endpoint and IAM requests are signed with `us-east-1`; the AWS preset keeps that value while making the fallback partition-aware. In the admin UI, AWS endpoint URLs are derived from the selected region and are not manually edited; use the **Other** provider type for custom endpoints, proxies, or non-native AWS-compatible services.

The AWS type enables S3, STS, IAM, static website, and SSE capabilities by default. Ceph-specific admin, account, usage, metrics, and RGW SNS capabilities remain disabled.

## Expected behavior

- Browser workflows usually work with standard S3 compatibility.
- Manager IAM workflows require real IAM support from backend.
- Account-centric workflows may be limited when no account model exists.
- Portal Storage Spaces require an account model and Portal orchestration that can project grants to storage-side enforcement.
- Usage, billing, metrics, RGW SNS topics, and Ceph Admin pages may stay unavailable even when object browsing works.

## Recommendation

Maintain an internal support matrix by backend and version for production usage.

Minimum matrix columns:

| Column | Why |
|---|---|
| Backend and version | S3-compatible behavior changes by product and release. |
| Endpoint type | AWS, Ceph, or Other determines default capabilities. |
| Browser read/write | Confirms baseline object operations. |
| IAM support | Determines Manager IAM availability. |
| Usage/metrics | Determines Admin, Manager, and Portal analytics reliability. |
| Known unsupported features | Prevents users from treating hidden actions as permission issues. |

## Related pages

- [Backends: compatibility matrix](backends-compatibility.md)
- [Feature availability](../user/feature-availability.md)

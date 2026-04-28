# Backends: Other S3 Implementations

s3-manager can integrate with non-Ceph S3-compatible backends such as AWS S3 and MinIO.

## AWS

Use the dedicated **AWS** endpoint type when targeting native Amazon S3. It preconfigures the validated global legacy mode:

- `https://s3.amazonaws.com` for S3
- `https://sts.amazonaws.com` for STS
- `https://iam.amazonaws.com` for IAM
- `us-east-1` as the default region

The AWS type enables S3, STS, IAM, static website, and SSE capabilities by default. Ceph-specific admin, account, usage, metrics, and RGW SNS capabilities remain disabled.

## Expected behavior

- Browser workflows usually work with standard S3 compatibility.
- Manager IAM workflows require real IAM support from backend.
- Account-centric workflows may be limited when no account model exists.

## Recommendation

Maintain an internal support matrix by backend and version for production usage.

## Related pages

- [Backends: compatibility matrix](backends-compatibility.md)

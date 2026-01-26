
# MinIO and other S3 backends

s3-manager can target other S3-compatible implementations such as MinIO.

## Expectations

- Browser capabilities should work when S3 compatibility is sufficient.
- Manager IAM features require a backend with meaningful IAM support.
- “Accounts” model is Ceph-specific; other backends may not expose an equivalent.

## Recommendation

If you want s3-manager to be a strong multi-backend console:

- explicitly document which features are supported per backend
- keep Browser surface minimal and standards-based
- treat any vendor-specific behavior as an extension, not a requirement

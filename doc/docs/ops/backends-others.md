# Backends: Other S3 Implementations

s3-manager can integrate with non-Ceph S3-compatible backends such as MinIO.

## Expected behavior

- Browser workflows usually work with standard S3 compatibility.
- Manager IAM workflows require real IAM support from backend.
- Account-centric workflows may be limited when no account model exists.

## Recommendation

Maintain an internal support matrix by backend and version for production usage.

## Related pages

- [Backends: compatibility matrix](backends-compatibility.md)

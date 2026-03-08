# Backends: Ceph RGW

Ceph RGW is a primary target, especially when RGW Accounts are available.

## What is typically used

- S3 APIs for buckets/objects/configuration.
- IAM APIs for principals and policies.
- RGW Admin Ops for account and operational controls.

## Operational considerations

- Validate feature support per Ceph release.
- Consider multisite implications in production.
- Document cluster-specific limits for your organization.

## Related pages

- [Backends: compatibility matrix](backends-compatibility.md)
- [Workspace: Ceph Admin](../user/workspace-ceph-admin.md)

# Backends: Ceph RGW

Ceph RGW is a primary target, especially when RGW Accounts are available.

## What is typically used

- S3 APIs for buckets/objects/configuration.
- IAM APIs for principals and policies.
- RGW Admin Ops for account and operational controls.
- Usage logs and metrics for quota, billing, and capacity views when enabled.
- RGW SNS topic APIs when event workflows are available on the endpoint.

## Operational considerations

- Validate feature support per Ceph release.
- Consider multisite implications in production.
- Document cluster-specific limits for your organization.
- Keep the RGW Admin Ops credential restricted to documented admin and internal collection flows.
- Give the RGW Admin Ops identity `buckets=write` only when Manager bucket quota
  management is enabled. The per-account or per-user
  `allow_bucket_quota_management` grant authorizes a BucketReef target; it does
  not add capabilities to the RGW service identity.
- If the S3 endpoint URL is not the RGW Admin Ops URL, configure the dedicated
  Admin endpoint override instead of relying on the S3 endpoint as a fallback.
- Test lifecycle, notifications, versioning, object lock, bucket policy, CORS, website, logging, and replication on the target Ceph release before promising them to tenants.
- Validate account quota behavior on the target release before enabling quota-management workflows.
- Enable Manager Ceph S3 User key management only for managed S3 User contexts
  where operators are allowed to create, disable, enable, or delete RGW access
  keys. The global Manager setting, user or group tool access, the S3 User allow
  flag, and Admin Ops credentials must all line up.

## Admin Ops capability for Manager bucket quotas

Manager updates an individual bucket through `PUT /admin/bucket`. Ceph requires
the Admin Ops identity signing that request to have `buckets=write`.
`accounts=write` authorizes account-level quota operations, but it does not
authorize an individual bucket quota update.

Create a new BucketReef Admin Ops identity with the complete expected capability
set:

```bash
radosgw-admin user create \
  --uid="bkr-admin" \
  --display-name="BucketReef Admin Ops" \
  --caps="users=read,write;accounts=read,write;buckets=write"
```

For an existing identity created without the bucket capability, add only the
missing capability and keep the existing access keys:

```bash
radosgw-admin caps add --uid="bkr-admin" --caps="buckets=write"
```

Confirm the returned `caps` include `buckets=write`, then reopen the account or
RGW user in Admin. BucketReef detects this capability before allowing the
`Bucket quota management` target grant and revalidates it when Manager exposes
or executes the action.

## Minimum lab validation

1. Configure a Ceph endpoint and run healthchecks.
2. Create or import an RGW account.
3. Select the account in Manager and list buckets.
4. Validate IAM user or policy listing when IAM is enabled.
5. Run Browser upload/download on a small object.
6. If S3 User key lifecycle is delegated to Manager, create a disposable key,
   verify it once with an external S3 client, then disable or delete it.
7. Confirm usage-history or metrics collection if the deployment exposes quota, billing, or Portal usage.

## Related pages

- [Backends: compatibility matrix](backends-compatibility.md)
- [Workspace: Ceph Admin](../user/workspace-ceph-admin.md)
- [Feature: Ceph access keys in Manager](../user/feature-manager-ceph-keys.md)
- [Production readiness](production-readiness.md)

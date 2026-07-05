# Portal: Replications

Use this page when you need to review or request a guided replication between Storage Spaces in the selected Portal workspace.

## Prerequisites

- Portal is enabled.
- Your UI user is linked to the selected Portal project or account.
- You have Portal manager rights to create a workspace replication.
- The two Storage Spaces are visible in the workspace and are backed by compatible Ceph storage locations in the same zonegroup.
- Bucket-level replication is allowed by the platform team on both storage locations.
- The source storage endpoint declares its Ceph `zone_name` and lists the
  destination zone in `bucket_replication_target_zones`; for example `z1` can
  target `z2` only when the endpoint explicitly declares `["z2"]`.
- RGW Account-owned buckets are configurable only when the source and
  destination endpoints declare `bucket_replication_owner_mode =
  rgw_account_supported`. Otherwise Portal shows the limitation before it tries
  to configure Ceph.

## What Portal can show

| Item | Meaning |
|---|---|
| Platform replication | The storage platform already replicates matching Storage Spaces between storage locations. No extra workspace replication is needed for that pair. |
| Workspace replication | A bucket-level replication rule was configured for a source Storage Space and a destination Storage Space. |
| Destination outside this workspace | A rule exists, but the destination Storage Space is not visible to you in the selected workspace. |

## Create a workspace replication

1. Open **Portal > Replications**.
2. Confirm that the expected project is selected in the topbar.
3. Choose a source Storage Space.
4. Choose a destination Storage Space on a compatible storage location.
5. Select **Configure**.

Portal prepares both sides automatically: it enables versioning where needed
and configures the source replication rule through the stored RGW account
credentials with the standard S3 bucket replication API. It does not use Ceph
Admin credentials for this workflow.

## Expected result

The replication appears in **Current replications** with the source, destination, and status. Newly uploaded files in the source Storage Space are copied by the storage platform to the destination when the backend supports the requested bucket-level replication setup.

## If Configure is disabled

The page explains the missing condition. Common causes are read-only Portal
access, no second compatible storage location, a platform-level replication
already covering the pair, bucket-level replication being disabled on one
endpoint, an undeclared Ceph zone direction, or a cluster that supports
bucket-level replication only for classic RGW user-owned buckets.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Storage Spaces](portal-storage-spaces.md)
- [Portal: Activity](portal-activity.md)
- [Feature availability](feature-availability.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-portal.light.png" alt="Portal workspace with project dashboard cards and navigation" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-portal.dark.png" alt="Portal workspace with project dashboard cards and navigation" loading="lazy">
</div>

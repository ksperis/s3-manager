# Portal: Access Keys

Use this page when you need S3 credentials for an external tool.

When the selected workspace is a Project, keys are created per Ceph zonegroup.
One Project key can cover several RGW Accounts in the same zonegroup, but it is
still limited to the Storage Spaces you can access in that Project.

## Before you start

- Portal access-key creation is enabled for the selected workspace.
- For Project workspaces, each storage endpoint has a configured Ceph zonegroup.
- You understand which external tool will use the key.
- You are ready to copy the secret when it is shown.

## Steps

1. Open **Portal > Access keys**.
2. Review the endpoint guidance shown on the page.
3. For a Project, choose the zonegroup card that matches the storage location.
4. Create a key for the external use case.
5. Copy the secret immediately. It is shown only once.
6. Store the key in the external tool or secret manager.
7. Rotate or delete unused keys when they are no longer needed.

## Important limits

- The Portal runtime key used by the application is intentionally hidden.
- User-managed keys may have a maximum count set by admins.
- Project keys are not duplicated per RGW Account when accounts share a
  zonegroup.
- Access keys do not grant access to Storage Spaces unless the Portal database
  grants and synchronized storage policies allow it.

## You are done when

The external client can connect to the documented endpoint and access only the intended Storage Space or bucket scope.

## If key creation is unavailable

Ask an admin whether Portal user access-key creation is enabled, whether the
Project endpoints have a Ceph zonegroup configured, and whether your workspace
or zonegroup reached the maximum number of user-managed keys.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Storage Spaces](portal-storage-spaces.md)
- [Portal: Settings](portal-settings.md)
- [Feature availability](feature-availability.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-access-keys.light.png" alt="Portal Access keys page with endpoint guidance, one-time secret warning, and external key actions" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-access-keys.dark.png" alt="Portal Access keys page with endpoint guidance, one-time secret warning, and external key actions" loading="lazy">
</div>

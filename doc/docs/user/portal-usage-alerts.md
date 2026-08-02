# Portal: Storage Health

Use this page when you need to know whether there is room for more files, which
spaces are growing, how files moved in or out, or what the current month may
cost.

## Before you start

- Select the right project.
- Usage, quota, transfer-activity, or cost collection must be enabled by the platform for the matching tab to appear.
- Some metrics may be unavailable even when file access works.

## What Portal can show

| Signal | Meaning |
|---|---|
| Overview | Storage used, room left, file count, and visible spaces for the selected workspace. |
| By space | Per-space storage and file counts only for spaces you can access. |
| File types | Optional breakdown of visible files by type, size, and storage class. |
| Trends | Stored readings that show whether storage and file counts are growing. |
| Uploads & downloads | File movement and activity when traffic collection is available. |
| Costs | Optional monthly estimate for storage and transfer activity. |
| Other | Anonymous storage used elsewhere in the project. It is not a Storage Space you can open and does not reveal hidden names or identifiers. |
| Alerts | Deduplicated warnings such as quota near limit, public links, or a degraded endpoint. |

Traffic details are shown only for Storage Spaces you can access.
The dashboard may keep global totals so you can understand quota pressure, but
it must not expose the names of other users' private spaces.

## You are done when

You can tell whether the selected project has room left, which spaces need attention, whether file movement looks normal, and whether cost data is available.

## If a metric is unavailable

Unavailable metrics do not always mean the space is broken. Ask an admin to check
feature flags, collection jobs, endpoint capability, and the latest backend
readings. If the **Costs** tab is visible but empty, the page shows the billing
source error returned by the backend.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Storage Spaces](portal-storage-spaces.md)
- [Portal: Settings](portal-settings.md)
- [Feature: Bucket usage stats](feature-bucket-usage-stats.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-usage.light.png" alt="Portal Storage Health page with room left, file counts, space breakdown, and Costs tab available" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-usage.dark.png" alt="Portal Storage Health page with room left, file counts, space breakdown, and Costs tab available" loading="lazy">
</div>

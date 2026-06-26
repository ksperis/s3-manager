# Portal: Usage and Alerts

Use this page when you need to understand storage consumption, traffic, quota, billing source, or simple alerts in Portal.

## Before you start

- Select the right Portal account.
- Usage, quota, traffic, or billing collection must be enabled by the platform.
- Some metrics may be unavailable even when file access works.

## What Portal can show

| Signal | Meaning |
|---|---|
| Storage used | Account or visible Storage Space consumption reported by the backend. |
| Quota | Account quota when configured and available. |
| Usage by Storage Space | Per-space storage and object counts when reported by the Portal usage API. |
| Usage history | Stored trend snapshots for the selected Portal account. |
| Traffic and requests | Traffic metrics or billing-derived values when collection is available. |
| Billing source | Optional billing data for the selected account and month. |
| Alerts | Deduplicated warnings such as quota near limit, public links, failed transfer, or degraded endpoint. |

## You are done when

You can tell whether the selected Portal account is healthy, near quota, missing metrics, or affected by an alert.

## If a metric is unavailable

Unavailable metrics do not always mean the Storage Space is broken. Ask an admin to check feature flags, collection jobs, endpoint capability, and the latest backend snapshots.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Storage Spaces](portal-storage-spaces.md)
- [Feature: Bucket usage stats](feature-bucket-usage-stats.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-usage.light.png" alt="Portal Usage and Analytics page with storage, traffic, requests, per-space breakdown, and billing source" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-usage.dark.png" alt="Portal Usage and Analytics page with storage, traffic, requests, per-space breakdown, and billing source" loading="lazy">
</div>

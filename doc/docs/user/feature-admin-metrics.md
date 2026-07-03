# Feature: Admin Usage and Metrics

Use this page when you need platform-level storage, traffic, or usage analytics from Admin.

## When to use

Use **Admin > Usage & Metrics** to understand endpoint-wide capacity and usage signals before investigating a tenant or bucket.

## Prerequisites

- `ui_admin` or `ui_superadmin` access.
- Endpoint metrics or usage collection is enabled for the selected backend.
- Scheduler or CronJob collection is running when you expect historical data.

## Steps

1. Open **Admin > Usage & Metrics**.
2. Select the relevant endpoint or tab when the page offers multiple metric families.
3. Compare storage totals, usage composition, usage history, and traffic charts.
4. If a number is stale, check the latest usage-history or metrics collection time.
5. Use Manager or Ceph Admin for bucket/account-level drilldown when platform totals point to a narrower scope.

## Expected result

You can tell whether a storage issue is platform-wide, endpoint-specific, or limited to a tenant/bucket view.

## You are done when

You can report the metric name, endpoint, visible time range, last collection time, and next page to inspect.

## If you do not see this action

Check `endpoint_status_enabled`, usage-history settings, endpoint capability, and your Admin role before changing storage permissions.

## Limits / feature flags

!!! note
    Metrics are observability data. They do not grant access to objects, buckets, accounts, or Portal Storage Spaces.

## Related pages

- [Feature: Usage History in Admin](feature-usage-history-admin.md)
- [Feature: Bucket usage stats](feature-bucket-usage-stats.md)
- [Ops / Observability](../ops/operations-observability.md)
- [Ops / Quota monitoring and history](../ops/operations-quota-monitoring.md)

## Visual example

This page reuses the bucket usage stats screenshot because the Admin page follows the same usage-analysis vocabulary at platform scope.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/feature-bucket-usage-stats.light.png" alt="Bucket usage stats with storage, usage history, and traffic tabs" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/feature-bucket-usage-stats.dark.png" alt="Bucket usage stats with storage, usage history, and traffic tabs" loading="lazy">
</div>

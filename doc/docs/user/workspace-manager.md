# Workspace: Manager

## When to use

Use **Manager** for account-scoped administration aligned with S3/IAM semantics.

## Prerequisites

- Access to `/manager`.
- A valid execution context selected (`ctx` or default context).

## Steps

1. Open `/manager` and select the correct account/context.
   - If you enabled **Show tags in top selectors** from [User profile](profile.md), compact color-coded `Standard` account and endpoint tags are shown directly in the selector. `Administrative` tags remain limited to management surfaces.
2. Use **Usage & Metrics** for tabbed account-level usage composition, storage analytics, usage history, and traffic analytics.
3. Use **Storage** for buckets and manager browser (if enabled).
4. Use **IAM** for users, groups, roles, and policies (if IAM capability is available).
5. Use **Events** for SNS topics (if endpoint supports SNS).
6. Use **Tools** for:
   - Feature rules inventory (if authorized)
   - Bucket Compare (if enabled)
   - Bucket Integrity (if enabled)
   - Bucket Purge (if enabled and authorized)
   - Bucket Migration (if enabled and authorized)
7. Use **Ceph > Access keys** for delegated RGW S3 User key lifecycle when the
   selected context is a managed S3 User and the feature is enabled.

## Expected result

Tenant resources are managed in the right scope with explicit context control.

## Limits / feature flags

!!! note
    IAM pages depend on endpoint IAM capability. Tools depend on the Manager tools access configured directly on the UI user or inherited from UI groups. Bucket Compare, Bucket Integrity, Bucket Purge, Bucket Migration, and Ceph S3 User keys also depend on their matching global Manager settings. Bucket usage stats are available from Usage & Metrics and bucket details when the global bucket usage stats setting is enabled.

## Related pages

- [Feature: Buckets](feature-buckets.md)
- [User profile](profile.md)
- [How-to: Configure a bucket from Manager](howto-manager-bucket-configuration.md)
- [Feature: IAM](feature-iam.md)
- [Feature: Ceph access keys in Manager](feature-manager-ceph-keys.md)
- [Feature: SNS topics](feature-topics.md)
- [Feature: Bucket compare](feature-bucket-compare.md)
- [Feature: Bucket integrity check](feature-bucket-integrity-check.md)
- [Feature: Bucket purge](feature-bucket-purge.md)
- [Feature: Bucket usage stats](feature-bucket-usage-stats.md)
- [Feature: Bucket migration](feature-bucket-migration.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-manager.light.png" alt="Manager workspace with buckets, topics and migration tools" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-manager.dark.png" alt="Manager workspace with buckets, topics and migration tools" loading="lazy">
</div>

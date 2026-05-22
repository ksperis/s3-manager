# Workspace: Portal

## When to use

Use **Portal** for self-service bucket and access-key work on a Ceph RGW account where IAM is enabled.

## Prerequisites

- The global `portal_enabled` setting is enabled.
- Your UI user is explicitly linked to the account with `portal_user` or `portal_manager`.
- The account is backed by a Ceph storage endpoint with IAM capability enabled.

## Steps

1. Open `/portal`.
2. Select the portal account context in the top bar.
3. Use **Home** for the dashboard, quick bucket actions, IAM keys, usage, traffic, billing status, and endpoint health.
4. Bootstrap your portal IAM identity if the dashboard asks for it.
5. Use **Buckets** for the buckets exposed to your portal identity.
6. Use **Browser** from Portal only when `browser_portal_enabled` is enabled and you need object-level operations.
7. Portal managers can use **Manage access** and **Settings** for account-scoped portal delegation.

## Expected result

Portal actions use IAM users, groups, policies, and access keys as the source of truth for S3 access.

## Limits / feature flags

!!! note
    Portal roles are independent from Manager access. `portal_user` and `portal_manager` do not grant `/manager`; `/manager` still requires `account_admin` or `is_root` on the account link. Existing account links default to `portal_none` until an admin assigns a portal role.

!!! note
    Portal requires `portal_enabled`, a Ceph RGW account, and endpoint IAM capability. `/portal/browser` also requires `browser_enabled` and `browser_portal_enabled`.

## Related pages

- [Workspace: Browser](workspace-browser.md)
- [Feature: Buckets](feature-buckets.md)
- [Feature: IAM](feature-iam.md)
- [Use cases for storage users](use-cases-storage-user.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-portal.light.png" alt="Portal workspace dashboard with self-service buckets and IAM status" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-portal.dark.png" alt="Portal workspace dashboard with self-service buckets and IAM status" loading="lazy">
</div>

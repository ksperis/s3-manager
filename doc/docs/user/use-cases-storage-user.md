# Use Cases for Storage Users

## When to use

Use this page when your main goal is object access, limited bucket actions, or guided self-service.

## Prerequisites

- Role with user access (`ui_user` or delegated equivalent).
- At least one available execution context (account, connection, or allowed S3 user path).

## Steps

1. For object work, open **Browser**:
   - Browse buckets and prefixes.
   - Upload, download, preview, delete, restore versions.
2. For guided tenant workflows, open **Portal** (if enabled):
   - Use account-scoped self-service actions.
3. For advanced bucket/IAM operations with delegated rights, open **Manager**.
4. If an action is unavailable, verify selected context and request additional permissions.

## Expected result

You can complete daily storage tasks without navigating admin-only areas.

## Limits / feature flags

!!! note
    Access depends on role, account links, connection permissions, and flags like `browser_root_enabled`, `browser_portal_enabled`, and `manager_enabled`.

## Related pages

- [Workspace: Browser](workspace-browser.md)
- [Workspace: Portal](workspace-portal.md)
- [Feature: Object operations in Browser](feature-objects-browser.md)

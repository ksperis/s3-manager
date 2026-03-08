# Workspace: Portal

## When to use

Use **Portal** for guided self-service workflows in a selected account scope.

## Prerequisites

- Portal enabled.
- Account link with portal role (`portal_user` or `portal_manager`).

## Steps

1. Open `/portal`.
2. Select the portal account context in top bar.
3. Use **Home** for dashboard and quick actions.
4. If `portal_manager`, use **Buckets** and management pages.
5. Use **Browser** from portal only if portal-browser integration is enabled.
6. Use **Settings** to review portal-level behavior.

## Expected result

Users complete controlled workflows without requiring full admin surfaces.

## Limits / feature flags

!!! note
    Portal depends on `portal_enabled`. Additional behavior depends on portal settings and `browser_portal_enabled`.

## Related pages

- [Use cases for storage users](use-cases-storage-user.md)
- [Workspace: Browser](workspace-browser.md)

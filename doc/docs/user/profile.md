# User Profile and Private S3 Connections

## When to use

Use this page when you need to adjust personal UI preferences or manage your own private S3 connections.

## Prerequisites

- You can sign in to the UI.
- For private S3 connections, your role or instance settings must allow them.

## Steps

1. Open `/profile`.
2. In **Preferences**:
   - choose language and theme,
   - set the default workspace after sign-in,
   - enable **Show tags in top selectors** if you want compact color-coded tags in the topbar context and endpoint selectors on this browser.
3. In **Private S3 connections**:
   - create or edit your own private connection,
   - manage tags directly from the main form: add them inline, remove them with `×`, and click a tag badge to open its compact settings popover for color and `Standard` / `Administrative` scope,
   - search by name, endpoint, provider, or tag,
   - enable or disable access for `Manager` and `Browser`.

## Expected result

Your local UI preferences are updated, and your private connections remain easier to identify and filter.

## Limits / feature flags

!!! note
    The selector-tags preference is stored locally in the browser. It is not shared across browsers or devices. Tags marked `Administrative` stay visible in management lists and edit dialogs but are never shown in top selectors.

!!! note
    Private S3 connections remain private to their owner. Tags on those connections are also editable only by the owner.

!!! note
    Tag colors are shared per tag inside your own private-connections catalog. Recoloring a private tag updates the same tag everywhere in your private connection inventory.

## Related pages

- [Start here](start-here.md)
- [Workspace: Manager](workspace-manager.md)
- [Workspace: Browser](workspace-browser.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/user-overview.light.png" alt="User profile with preferences and private S3 connections" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/user-overview.dark.png" alt="User profile with preferences and private S3 connections" loading="lazy">
</div>

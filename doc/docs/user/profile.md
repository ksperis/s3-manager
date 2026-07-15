# User Profile, Private S3 Connections, and API Tokens

## When to use

Use this page when you need to adjust personal UI preferences, manage your own private S3 connections, or administer API tokens when your role allows it.

## Prerequisites

- You can sign in to the UI.
- For private S3 connections, your role or instance settings must allow them.

## Steps

1. Select **Profile** at the bottom of the sidebar, just above **Collapse**, or use the account menu in the topbar. The profile page opens inside your current workspace so its navigation and context remain available.
2. Use the **Profile** tab to update identity and preferences:
   - choose your profile image source: automatic, Gravatar, or initials,
   - upload or remove a personal PNG or JPEG image up to 1 MiB,
   - choose language and theme,
   - set the default workspace after sign-in,
   - enable **Show tags in top selectors** if you want compact color-coded tags in the topbar context and endpoint selectors on this browser,
   - choose whether you receive quota alert emails.
3. Use the **Private S3 connections** tab when it is available:
   - create or edit your own private connection,
   - manage tags directly from the main form: add them inline, remove them with `×`, and click a tag badge to open its compact settings popover for color and `Standard` / `Administrative` scope,
   - search by name, endpoint, provider, or tag,
   - enable or disable access for `Manager` and `Browser`.
4. Superadmins can use the **API tokens** tab for automation tokens. Other users do not see this tab.

## Expected result

Your local UI preferences are updated, and your private connections remain easier to identify and filter.
Quota notifications for accounts or RGW users you administer remain visible from
the topbar notification menu when the platform quota monitor raises them.

In automatic avatar mode, the UI uses your uploaded image first, then the image
provided by your OIDC identity provider, then Gravatar. Initials remain the
fallback when an image is missing or cannot be loaded. Choose **Initials** to
avoid loading an external profile image. The selected avatar is also used in
the account menu in the topbar.

## Limits / feature flags

!!! note
    The selector-tags preference is stored locally in the browser. It is not shared across browsers or devices. Tags marked `Administrative` stay visible in management lists and edit dialogs but are never shown in top selectors.

!!! note
    The quota email preference controls email delivery only. Topbar quota notifications
    are shown for accessible RGW accounts or users when quota monitoring is enabled.

!!! note
    Uploaded profile images are stored by the application and are visible only
    to you, administrators, and users who share a Portal project with you.

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

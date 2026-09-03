# User Profile and Sign-in Security

## When to use

Use this page when you need to adjust personal UI preferences, manage your sign-in security, or manage your own private S3 connections.

## Prerequisites

- You can sign in to the UI.
- For private S3 connections, your role or instance settings must allow them.

## Steps

1. Select **Profile** at the bottom of the sidebar, just above **Collapse**, or use the account menu in the topbar. The profile page opens inside your current workspace so its navigation and context remain available.
2. Use the **Profile** tab to update your avatar and preferences. The application administrator decides whether users may also edit their own full name.
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
   - delete a **Server managed** connection from this inventory when you no
     longer need it; BucketReef first removes the remote key and dedicated IAM
     identity, when applicable, before removing the local connection.
4. Use the **Security** tab to change an existing local password, enroll or review passkeys, regenerate ten one-time recovery codes, inspect your sessions, and review your external identities. Store newly displayed recovery codes outside the browser. The application administrator decides whether users may unlink external identities; the last password, OIDC, or LDAP sign-in method can never be removed. A passkey does not count as that primary method.
5. Administrators manage platform sessions and manual identity-link requests from **Platform > Identity security**. Superadmins manage scoped automation tokens from **Settings > API tokens**.

## Expected result

Your local UI preferences are updated, and your private connections remain easier to identify and filter.
The topbar notification menu shows quota alerts for accounts or RGW users you
administer. Administrators also see new Identity Security link requests within
their role hierarchy and endpoint health transitions. You can mark all
notifications as read, delete an individual entry, or use **Clear read** to
delete all entries already read. A failed deletion stays visible as an inline
error and does not close the menu.

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
    Notification visibility is revalidated against current access. By default,
    read and unread notifications expire after 90 days. Operators can change or
    disable this retention through `USER_NOTIFICATIONS_RETENTION_DAYS`.

!!! note
    Uploaded profile images are stored by the application and are visible only
    to you, administrators, and users who share a Portal project with you.

!!! note
    Private S3 connections remain private to their owner. Tags on those connections are also editable only by the owner.

!!! note
    A connection marked **Server managed** was created by **Create my private
    access** in Manager. Its endpoint, remote principal, and credentials cannot
    be edited or rotated from Profile. The owner can still change its name,
    tags, active state, and Manager/Browser availability. If remote deletion
    fails, the connection remains visible as **cleanup required**; use **Retry
    cleanup** instead of creating another access from the same source context.

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

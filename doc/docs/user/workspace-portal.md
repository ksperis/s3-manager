# Workspace: Portal

## When to use

Use **Portal** for an end-user Storage Workspace focused on storage spaces,
sharing, activity, transfers, usage, alerts, and simple preferences.

## Prerequisites

- The global `portal_enabled` setting is enabled.
- The global `browser_enabled` and `browser_portal_enabled` settings are
  enabled to browse files inside a Storage Space.
- Your UI user is explicitly linked to the account with Portal access.
- The account is backed by a storage endpoint configured by the platform team.

## Steps

1. Open `/portal`.
2. Select the portal account context in the top bar.
3. Use **Home** for the dashboard, quota, usage by Storage Space, recent
   activity, shared spaces, transfers, and simple alerts.
4. Use **Storage Spaces** to open an assigned space, browse files when content
   access is available, upload, download, and share with collaborators when the
   space is shared.
   You can also open `/browser` with the selected Portal account context for a
   Dropbox-like Storage Spaces sidebar; internal bucket names stay hidden.
5. Use **Access keys** to generate S3 credentials for external tools. The
   Portal runtime key is not shown in this list.
6. Use **Shares** to review items shared with you, items shared by you, and
   public links when enabled.
7. Use **Activity**, **Transfers**, and **Usage & Analytics** for collaboration
   history, usage composition, usage history, and consumption tracking.
8. Use **Settings** for simple account and preference changes.

## Main workflows

| Workflow | Read next | What it covers |
|---|---|---|
| Open, create, import, or archive a Storage Space | [Portal: Storage Spaces](portal-storage-spaces.md) | Access modes, active/archived states, creation, and imports. |
| Browse, upload, download, or inspect files | [Portal: Files](portal-files.md) | Object list, folders, safe details, and Portal-specific limits. |
| Share with collaborators or understand roles | [Portal: Sharing](portal-sharing.md) | Viewer, Editor, Owner, public links, and archived-space behavior. |
| Create credentials for external S3 tools | [Portal: Access Keys](portal-access-keys.md) | One-time secrets, endpoint guidance, and hidden runtime keys. |
| Understand quota, usage, traffic, and alerts | [Portal: Usage and Alerts](portal-usage-alerts.md) | Storage used, per-space usage, history, billing source, and unavailable metrics. |
| Review recent changes | [Portal: Activity](portal-activity.md) | Portal-visible Storage Space and file events. |
| Follow file operations | [Portal: Transfers](portal-transfers.md) | Queued, running, completed, and failed transfers. |
| Adjust preferences | [Portal: Settings](portal-settings.md) | Simple account, security, and preference cards. |

## Portal model in one minute

- **Storage Spaces** are the user-facing storage areas registered in Portal. They may map to buckets internally, but buckets that are not registered as Portal Storage Spaces stay hidden from Portal lists.
- **Private** spaces are visible to their owner and Portal managers. Portal
  managers can administer private-space metadata, visibility, and archive state,
  but they cannot browse files in a private space owned by someone else.
- **All** spaces are shared with current and future Portal members of the
  selected account. **Restricted** spaces are shared only with selected
  collaborators with Viewer, Editor, and Owner grants.
- Regular `portal_user` members can create only private Storage Spaces, and only
  when Portal user Storage Space creation is enabled for the account.
- **Archived** spaces stay registered but suspend file browsing, sharing, and public links until restored.
- **Usage** can show the global account total and quota. For regular Portal
  users, Storage Space details, activity, and transfers are limited to spaces
  they can access; undisclosed usage can appear only as the anonymous `Other`
  aggregate.
- File browsing inside a Storage Space uses a locked Portal profile of Browser. Advanced object inspection stays in Browser or Manager.
- `/browser` can also run with a Portal account context when Portal Browser is enabled. It still uses Portal wording and permissions instead of account-management controls.
- Portal roles come from the owner, the Storage Space access mode, and
  collaborator grants managed in Portal. External S3 keys are synchronized from
  those records; IAM is not the source of Portal listings or roles.

## Expected result

Portal actions stay user-oriented and use the Portal Storage Space registry and
collaborator grants as their source of truth.

## Limits / feature flags

!!! note
    Portal roles are independent from Manager access. Portal access does not
    grant `/manager`; `/manager` still requires the appropriate account
    administration rights.

!!! note
    Portal requires `portal_enabled` and an explicit account link. File browsing
    inside Storage Spaces also requires `browser_enabled` and
    `browser_portal_enabled`. Advanced object inspection belongs in `/browser`,
    not inside Portal.

## Related pages

- [Portal: Storage Spaces](portal-storage-spaces.md)
- [Portal: Files](portal-files.md)
- [Portal: Sharing](portal-sharing.md)
- [Portal: Access Keys](portal-access-keys.md)
- [Portal: Usage and Alerts](portal-usage-alerts.md)
- [Portal: Activity](portal-activity.md)
- [Portal: Transfers](portal-transfers.md)
- [Portal: Settings](portal-settings.md)
- [Workspace: Browser](workspace-browser.md)
- [Use cases for storage users](use-cases-storage-user.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-portal.light.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-portal.dark.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
</div>

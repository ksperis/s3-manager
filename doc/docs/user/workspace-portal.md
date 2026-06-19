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
4. Use **Storage Spaces** to open an assigned space, browse files, upload,
   download, and share with collaborators when the space is shared.
5. Use **Access keys** to generate S3 credentials for external tools. The
   Portal runtime key is not shown in this list.
6. Use **Shares** to review items shared with you, items shared by you, and
   public links when enabled.
7. Use **Activity**, **Transfers**, and **Usage & Analytics** for collaboration
   history and consumption tracking.
8. Use **Settings** for simple account and preference changes.

## Portal V3 workflows

### Dashboard

The dashboard is the default Portal landing page. It summarizes total storage,
object counts, requests, egress, usage by Storage Space, recent activity,
recent transfers, and simple alerts. It should never open directly inside a
bucket or advanced object browser.

### Storage Spaces and files

**Storage Spaces** are the user-facing abstraction for assigned storage areas.
In v1, a Storage Space can still map to a bucket internally, but Portal labels
and navigation stay user-oriented.

A Storage Space has a visibility:

- **Private**: visible to its owner and Portal managers only.
- **Shared**: visible through the existing Viewer, Editor, and Owner grants.

A Storage Space can also be **Archived**. Archived spaces stay registered for
future restoration, but Portal file browsing, sharing, and public links are
suspended while the archive status is active.

From a Storage Space, users can:

- browse folders and files;
- upload files when their role allows it;
- download files they can read;
- create simple folders when their role allows it;
- delete files only when their role allows it;
- open a file detail view with safe metadata and a safe preview when available.

The file browser shown inside a Storage Space is the main Browser in a locked,
minimal Portal profile. It opens only the selected Storage Space, keeps the
Storage Space label in the UI, and uses the Portal execution identity.
Archived Storage Spaces do not show the embedded file browser.
For Viewer spaces, upload, folder creation, and delete actions are hidden from
the embedded browser. Storage-side IAM/S3 permissions remain the enforcement
source for every operation.

Use **Details** on a file to open the Portal object detail page. This page
keeps the safe preview, public-link workflow, basic metadata, and recent object
events separate from the advanced Browser object-inspection tools.

Advanced object features such as versions, tags, raw metadata headers, object
lock, diagnostics, and batch operations belong in Browser or Manager, not in
Portal.

Uploads and backend-observed downloads are shown in **Transfers** immediately.
Direct downloads opened through a presigned browser URL may appear in Activity
when the backend issues the URL or serves the object, but Portal does not mark
the browser's final file-save completion because the application cannot observe
that event.

### Access keys for external tools

Portal users can create IAM access keys for S3-compatible clients such as CLI
tools, backup jobs, or desktop browsers. The secret is displayed only once when
the key is created, so copy it before leaving the page.

The key used internally by Portal to execute file operations is intentionally
hidden and cannot be disabled or deleted from the Access keys page. Admins can
disable Portal user key creation and set the maximum number of user-managed
keys from Portal settings.

### Sharing and roles

Portal exposes collaboration through simple roles:

- **Viewer** can list, read, and download.
- **Editor** can do Viewer actions plus simple upload, folder creation, and
  file deletion.
- **Owner** can do Editor actions plus manage sharing.

These roles are translated by the backend into storage-side permissions. They
do not create a separate permission source.

Only shared, active Storage Spaces can receive new shares or public links.
Private spaces keep access limited to the owner and Portal managers. Archived
spaces keep their stored grants and links so they can be restored later, but
those grants and links are inactive while archived.

### Settings

Portal settings are personal. Users can update their display name, password
when their sign-in provider allows it, UI language, theme, quota-alert email
preference, and default Portal account. These preferences are stored on the UI
user profile and do not grant access to accounts that are not already assigned.

### Empty and unavailable states

Portal uses real backend data first. When a source is missing, it shows a clear
empty or unavailable state:

- no Storage Spaces;
- no shares or public links;
- no recent activity;
- no recent transfers;
- no quota;
- no traffic metrics;
- no billing source;
- no alerts.

## Expected result

Portal actions stay user-oriented and use the storage permissions configured by
the platform as the source of truth.

## Usage, alerts, and availability

Portal metrics are scoped to the selected Portal account and use bytes for
storage and traffic values. Object counts are counts reported by the storage
backend.

- **Storage used** comes from the Portal usage API. When account-level usage is
  unavailable, Portal may use the sum of visible Storage Space usage. If neither
  source is available, the metric is shown as unavailable.
- **Quota** comes from the account quota exposed to Portal. If no quota is
  configured or metrics are disabled for the endpoint, Portal shows a clear
  unavailable state instead of treating the quota as unlimited.
- **Usage by Storage Space** is based on real per-space usage returned by the
  Portal usage API. When the backend cannot report per-space values, the chart
  is hidden behind an unavailable state.
- **Traffic and requests** come from traffic metrics for the selected account.
  If traffic collection is disabled or temporarily unavailable, Portal shows the
  last billing-derived values when available, otherwise an unavailable state.
- **Billing source** is optional. It appears only when billing is enabled and
  the selected account has billing data for the month.
- **Alerts** are deduplicated and ordered by severity. They can include quota
  near limit, public Storage Space or public link, expiring public link, failed
  transfer, and degraded storage endpoint signals.

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

- [Workspace: Browser](workspace-browser.md)
- [Use cases for storage users](use-cases-storage-user.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-portal.light.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-portal.dark.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
</div>

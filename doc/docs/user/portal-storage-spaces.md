# Portal: Storage Spaces

Use this page when you need to open, create, import, archive, or understand a Portal Storage Space.

## Before you start

- Portal is enabled for your account.
- Your UI user is linked to the selected Portal account.
- File browsing inside a Storage Space requires Portal Browser access.

## Main tasks

| Task | Where | Notes |
|---|---|---|
| Open an assigned space | **Portal > Storage Spaces** | Select a space to browse files and view usage. |
| Create a new space | **Storage Spaces > Create** | Regular Portal users create private spaces only, when Portal user Storage Space creation is enabled. Portal managers choose Private, All, or Restricted access before creation. |
| Import an existing bucket | **Storage Spaces > Import** | Portal managers can expose existing buckets as Storage Spaces and choose the initial access mode. Restricted imports can include selected collaborators immediately. |
| Archive a space | Space actions | Archived spaces keep metadata but suspend browsing, sharing, and public links. |
| Understand access | Space details > Access | The Access panel shows the current mode, owner, covered member count, direct collaborators, and public-link count. |

## Access modes

| Mode | Meaning |
|---|---|
| Private | Only the owner can browse files. Portal managers can still administer metadata and archive state. |
| All | Current and future Portal members of the selected account receive the chosen default access automatically. |
| Restricted | Only selected Portal members receive Viewer, Editor, or Owner access. Users outside the account must be added by an admin before they can be selected. |

When a Portal manager creates or imports a Restricted Storage Space, selected collaborators are saved with the Storage Space. If a searched person is not an eligible Portal member of the current account, request account access from an admin first.

## You are done when

The Storage Space appears in the list with the expected access mode, role, usage, and open action.

## If you do not see a space

Check the selected Portal account first. If it is still missing, ask an admin or Portal manager to verify your account link, Storage Space access mode, grants, and archive status.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Files](portal-files.md)
- [Portal: Sharing](portal-sharing.md)
- [Portal: Usage and alerts](portal-usage-alerts.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-storage-spaces.light.png" alt="Portal Storage Spaces list with search, usage, roles, status, and open actions" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-storage-spaces.dark.png" alt="Portal Storage Spaces list with search, usage, roles, status, and open actions" loading="lazy">
</div>

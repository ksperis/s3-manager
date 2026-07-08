# Portal: Spaces

Use this page when you need to create, open, organize, or archive a Portal space.

## Before you start

- Portal is enabled for your account.
- Your UI user is linked to the selected Portal account.
- File browsing inside a space requires Portal Browser access.

## Main tasks

| Task | Where | Notes |
|---|---|---|
| Open an assigned space | **Portal > Spaces** | Select a space to browse files and view usage. |
| Create a new space | **Spaces > Create space** | Regular Portal users create private spaces only, when Portal user space creation is enabled. Portal managers choose Private, Team, or Selected people access before creation. |
| Add existing storage | **Spaces > Add existing space** | Portal managers can expose existing buckets as spaces and choose the initial access mode. Selected people imports can include collaborators immediately. |
| Archive a space | Space actions | Archived spaces keep metadata but suspend browsing, sharing, and public links. |
| Understand collaborators | Space details > Collaborators | The Collaborators panel shows the current mode, owner, covered member count, direct collaborators, and public-link count. |
| Connect an external S3 tool | Space details > Connect external tools | Copy the space-to-bucket mapping, then open External tools with the space preselected. |

## Access modes

| Mode | Meaning |
|---|---|
| Private | Only the owner can browse files. Portal managers can still administer metadata and archive state. |
| Team | Current and future Portal members of the selected account receive the chosen default access automatically. |
| Selected people | Only selected people receive Viewer, Editor, or Owner access. Users outside the account must be added by an admin before they can be selected. |

When a Portal manager creates or imports a Selected people space, selected collaborators are saved with the space. If a searched person is not already available in the current account, ask an admin to add that external collaborator first.

## You are done when

The space appears in the list with the expected collaborators mode, role, usage, and open action.

For an external S3 tool, the space detail page shows the exact bucket name to
use. Keep using the space name inside Portal; use the bucket name only when the
external tool asks for it.

## If you do not see a space

Check the selected Portal account first. If it is still missing, ask an admin or Portal manager to verify your account link, space access mode, grants, and archive status.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Files](portal-files.md)
- [Portal: Collaborators](portal-sharing.md)
- [Portal: Usage and alerts](portal-usage-alerts.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-storage-spaces.light.png" alt="Portal Spaces list with create, upload, collaborator, public-link tasks and space rows" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-storage-spaces.dark.png" alt="Portal Spaces list with create, upload, collaborator, public-link tasks and space rows" loading="lazy">
</div>

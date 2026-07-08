# Portal: Collaborators

Use this page when you need to invite people to a Portal space or review public links.

## Before you start

- The space is active.
- You have Owner or Portal manager rights for collaborator management.
- The person you want to add already has Portal access to the selected account.
- Public links are enabled when you need link-based sharing.

## Portal roles

| Role | Can do |
|---|---|
| Viewer | List, read, and download. |
| Editor | Viewer actions plus upload, folder creation, and file deletion. |
| Owner | Editor actions plus sharing management. |

Portal uses the space owner, access mode, and collaborator grants shown in Portal to decide who can browse files. Technical S3 access for personal keys is synchronized from those database records. Portal managers may administer a private space's metadata without receiving file access to that private content.

## Access modes

| Mode | How sharing works |
|---|---|
| Private | No normal collaborator grants. File access stays with the owner. |
| Team | Every current and future Portal member of the selected account receives the default role, usually Editor. |
| Selected people | Owners choose specific people and assign Viewer, Editor, or Owner. |

## Main tasks

1. Open **Portal > Collaborators** or open a space and review the **Collaborators** panel.
2. Check the current mode, direct collaborators, and public-link count.
3. Add a collaborator from the people list with the least-powerful role that fits the task.
4. Set public-link expiry or access limits when public links are enabled.
5. Recheck the space access mode after changes.

## You are done when

The intended collaborator or link appears on the space, and the role matches the access you wanted to grant.

## If sharing is unavailable

Private spaces become Selected people spaces when you invite collaborators from **Portal > Collaborators**. Selected people spaces only accept users already allowed on the selected account; adding a new account member is a separate admin request. Archived spaces keep stored grants and links for future restoration, but those grants and links are inactive while archived.

## Related pages

- [Portal: Spaces](portal-storage-spaces.md)
- [Portal: Files](portal-files.md)
- [Feature availability](feature-availability.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-storage-spaces.light.png" alt="Portal Spaces list with collaborator task shortcuts and space rows" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-storage-spaces.dark.png" alt="Portal Spaces list with collaborator task shortcuts and space rows" loading="lazy">
</div>

# Portal: Sharing

Use this page when you need to understand who can access a Portal Storage Space or file.

## Before you start

- The Storage Space is shared and active.
- You have Owner or Portal manager rights for share management.
- The person you want to add already has Portal access to the selected account.
- Public links are enabled when you need link-based sharing.

## Portal roles

| Role | Can do |
|---|---|
| Viewer | List, read, and download. |
| Editor | Viewer actions plus upload, folder creation, and file deletion. |
| Owner | Editor actions plus sharing management. |

Portal uses the Storage Space owner, access mode, and collaborator grants shown in Portal to decide who can browse files. Technical S3 access for personal keys is synchronized from those database records. Portal managers may administer a private Storage Space's metadata without receiving file access to that private content.

## Access modes

| Mode | How sharing works |
|---|---|
| Private | No normal collaborator grants. File access stays with the owner. |
| All | Every current and future Portal member of the selected account receives the default role, usually Editor. |
| Restricted | Owners choose specific eligible Portal members and assign Viewer, Editor, or Owner. |

## Main tasks

1. Open the Storage Space and review the **Access** panel.
2. Check the current mode, direct collaborators, and public-link count.
3. Add a collaborator from the eligible Portal members list with the least-powerful role that fits the task.
4. Set public-link expiry or access limits when public links are enabled.
5. Recheck the Storage Space access mode after changes.

## You are done when

The intended collaborator or link appears on the Storage Space, and the role matches the access you wanted to grant.

## If sharing is unavailable

Private spaces cannot receive active collaborator grants. Existing direct grants are kept but inactive while the space is private. Restricted spaces only accept users already allowed on the selected account; adding a new account member is a separate admin request. Archived spaces keep stored grants and links for future restoration, but those grants and links are inactive while archived.

## Related pages

- [Portal: Storage Spaces](portal-storage-spaces.md)
- [Portal: Files](portal-files.md)
- [Feature availability](feature-availability.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-storage-spaces.light.png" alt="Portal Storage Spaces list with search, usage, roles, status, and open actions" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-storage-spaces.dark.png" alt="Portal Storage Spaces list with search, usage, roles, status, and open actions" loading="lazy">
</div>

# Portal: Sharing

Use this page when you need to understand who can access a Portal Storage Space or file.

## Before you start

- The Storage Space is shared and active.
- You have Owner or Portal manager rights for share management.
- Public links are enabled when you need link-based sharing.

## Portal roles

| Role | Can do |
|---|---|
| Viewer | List, read, and download. |
| Editor | Viewer actions plus upload, folder creation, and file deletion. |
| Owner | Editor actions plus sharing management. |

Portal uses the Storage Space owner and collaborator grants shown in Portal to decide who appears in sharing lists. Technical S3 access for personal keys is synchronized from those database records. Portal managers may administer a private Storage Space's metadata without receiving file access to that private content.

## Main tasks

1. Open the Storage Space.
2. Review current collaborators and links.
3. Add a collaborator with the least-powerful role that fits the task.
4. Set public-link expiry or access limits when public links are enabled.
5. Recheck the Storage Space visibility after changes.

## You are done when

The intended collaborator or link appears on the Storage Space, and the role matches the access you wanted to grant.

## If sharing is unavailable

Private spaces cannot receive normal collaborator grants. Archived spaces keep stored grants and links for future restoration, but those grants and links are inactive while archived.

## Related pages

- [Portal: Storage Spaces](portal-storage-spaces.md)
- [Portal: Files](portal-files.md)
- [Feature availability](feature-availability.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-storage-spaces.light.png" alt="Portal Storage Spaces list with search, usage, roles, status, and open actions" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-storage-spaces.dark.png" alt="Portal Storage Spaces list with search, usage, roles, status, and open actions" loading="lazy">
</div>

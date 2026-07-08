# Portal: Transfers

Use this page to check whether files you added to a space or downloaded from a space are still moving, finished, or need another try.

## When to use

Use **Portal > Transfers** after adding files, downloading files, or starting a large file operation from a Storage Space.

The page is a progress view. Start the work from **Portal > Spaces**, then use
**Transfers** to confirm what happened.

## Prerequisites

- Portal file browsing is enabled.
- The selected Storage Space is active.
- Your role allows the transfer action you started.

## Steps

1. Start from **Portal > Spaces** and open the space that contains your files.
2. Add files to the space or download files from it.
3. Open **Portal > Transfers**.
4. Use the summary to see what is still in progress, completed, or needs attention.
5. Use the table to find the file, the related space, the action, and the note.
6. For a failed transfer, reopen the related space and retry when the cause is clear.

## Expected result

You can tell whether a file is still moving, available in the space, saved by your browser, or waiting for a retry.

## You are done when

The transfer row reaches the expected state and the file list matches the intended result.

## If you do not see this action

Transfer visibility depends on Portal file access and the current user session. If the page is empty, start from a Storage Space and upload or download a file first.

## Limits / feature flags

!!! note
    Portal transfers are scoped to self-service file work. External tools and public links have their own delivery flows.

## Related pages

- [Portal: Files](portal-files.md)
- [Feature: Object operations in Browser](feature-objects-browser.md)
- [Feature: Bucket migration](feature-bucket-migration.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

This page reuses the Portal dashboard screenshot because it shows transfers in the Portal home context.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-portal.light.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-portal.dark.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
</div>

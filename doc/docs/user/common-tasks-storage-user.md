# Common Tasks for Storage Users

Use this page when you know what you want to do, but not which workspace or page to open.

## Quick task map

| Task | Go to | What to check first |
|---|---|---|
| Browse files in an assigned space | [Portal: Spaces](portal-storage-spaces.md) | The expected project is selected. |
| Browse files in a bucket or connection | [Workspace: Browser](workspace-browser.md) | The account or connection context is selected in the topbar. |
| Upload or download files in a Portal space | [Portal: Files](portal-files.md) | You have Editor or Owner access for upload, and content access for download. |
| Upload or download files in a bucket or connection | [Feature: Object operations in Browser](feature-objects-browser.md) | The account or connection context is selected in Browser. |
| Recover or inspect a previous object version | [Feature: Object versions in Browser](feature-object-versions-browser.md) | Versioning is enabled on the bucket. |
| Create credentials for an external S3 client | [Portal: External tools](portal-access-keys.md) | Portal external-tool credential creation is enabled for your project. |
| Understand room left, usage, or alerts | [Portal: Storage health](portal-usage-alerts.md) | Usage collection is available for the selected project. |
| Report missing access | [Troubleshooting](troubleshooting.md) | Capture workspace, account/context, bucket or space, and exact error text. |

## A good first workflow

1. Open **Portal** if your organization gives you spaces.
2. Create or open the space for your project.
3. Add a small test file, then invite collaborators when the space is ready.
4. Open **Browser** only if you work directly with buckets, prefixes, and objects.
5. Select the project, account, or connection before acting.
6. If an action is hidden or disabled, check [feature availability](feature-availability.md) before reporting the issue.

## You are done when

You can name the workspace you need, select the right context, and complete a small object operation without visiting Admin or Ops pages.

## If something is missing

Missing actions usually mean one of four things: the selected context is wrong, the feature flag is disabled, the backend does not support the feature, or IAM/S3 denies the operation.

## Related pages

- [Start here](start-here.md)
- [Workspace: Portal](workspace-portal.md)
- [Workspace: Browser](workspace-browser.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/use-cases-storage-user.light.png" alt="Browser workspace with folders visible for a daily object workflow" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/use-cases-storage-user.dark.png" alt="Browser workspace with folders visible for a daily object workflow" loading="lazy">
</div>

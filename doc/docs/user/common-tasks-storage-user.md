# Common Tasks for Storage Users

Use this page when you know what you want to do, but not which workspace or page to open.

## Quick task map

| Task | Go to | What to check first |
|---|---|---|
| Browse files in an assigned Storage Space | [Portal: Storage Spaces](portal-storage-spaces.md) | The expected Portal account is selected. |
| Browse files in a bucket or connection | [Workspace: Browser](workspace-browser.md) | The account or connection context is selected in the topbar. |
| Upload or download files | [Feature: Object operations in Browser](feature-objects-browser.md) | You have write access for upload, and read access for download. |
| Recover or inspect a previous object version | [Feature: Object versions in Browser](feature-object-versions-browser.md) | Versioning is enabled on the bucket. |
| Create credentials for an external S3 client | [Portal: Access keys](portal-access-keys.md) | Portal access-key creation is enabled for your account. |
| Understand usage, quota, or alerts | [Portal: Usage and alerts](portal-usage-alerts.md) | Usage collection is available for the selected account. |
| Report missing access | [Troubleshooting](troubleshooting.md) | Capture workspace, account/context, bucket or Storage Space, and exact error text. |

## A good first workflow

1. Open **Portal** if your organization gives you Storage Spaces.
2. Open **Browser** if you work directly with buckets, prefixes, and objects.
3. Select the account, connection, or Portal account before acting.
4. Upload and download a small test file.
5. If an action is hidden or disabled, check [feature availability](feature-availability.md) before reporting the issue.

## You are done when

You can name the workspace you need, select the right context, and complete a small object operation without visiting Admin or Ops pages.

## If something is missing

Missing actions usually mean one of four things: the selected context is wrong, an operational feature is disabled, the backend does not support the feature, or IAM/S3 denies the operation.

## Related pages

- [Start here](start-here.md)
- [Workspace: Portal](workspace-portal.md)
- [Workspace: Browser](workspace-browser.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/use-cases-storage-user.light.png" alt="Browser workspace with folders, action bar, and inspector open for a daily object workflow" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/use-cases-storage-user.dark.png" alt="Browser workspace with folders, action bar, and inspector open for a daily object workflow" loading="lazy">
</div>

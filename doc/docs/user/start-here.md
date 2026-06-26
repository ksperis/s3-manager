# Start Here

## When to use

Use this page when you log in for the first time and need to understand where to work.

## Prerequisites

- You can sign in to the UI.
- Your account has at least one workspace available through role, account link, connection access, or entitlement.

## Steps

1. Sign in and let the UI redirect you to your default workspace.
2. Confirm available workspaces in the global topbar workspace selector.
3. Pick the workspace matching your task:
   - `Admin`: platform setup and governance.
   - `Manager`: bucket and IAM administration.
   - `Portal`: self-service buckets and access keys on explicitly assigned RGW accounts.
   - `Browser`: object operations.
   - `Ceph Admin`: Ceph cluster-level tasks.
   - `Storage Ops`: cross-context bucket operations.
4. If you see account, context, or endpoint selectors in the topbar, select the right execution context before acting.
5. If compact selector tags help your workflow, enable **Show tags in top selectors** from [User profile](profile.md) to display color-coded `Standard` tags directly in the top selectors. `Administrative` tags stay limited to management lists and edit surfaces.

## Choose the right workspace

| Your goal | Workspace | First action | Ask an admin when... |
|---|---|---|---|
| Browse, upload, download, preview, or restore files | **Browser** | Select the right account or connection, then open the bucket. | The workspace is missing, the bucket is dimmed, or an action is disabled. |
| Work in an assigned self-service area | **Portal** | Select your Portal account, then open **Storage Spaces**. | You cannot see the expected Storage Space or need a new share/access key policy. |
| Configure buckets, IAM, topics, or Manager tools | **Manager** | Select the account context, then open the relevant section. | The account context is missing or a tool is hidden. |
| Configure users, endpoints, feature flags, audit, or billing | **Admin** | Open **Storage Backends**, **Platform**, or **Settings**. | You do not have `ui_admin` or `ui_superadmin`. |
| Work on Ceph RGW accounts, users, or cluster-wide buckets | **Ceph Admin** | Select the endpoint before taking action. | You do not have the Ceph Admin entitlement. |
| Run cross-context bucket operations | **Storage Ops** | Open **Buckets**, then filter by context and endpoint. | Your target context is not listed. |

## Understand the topbar selectors

- **Workspace** decides which product surface you are using.
- **Account / context** decides which credentials execute S3 or IAM actions.
- **Endpoint** appears on Ceph Admin and endpoint-scoped views. It decides which backend receives the request.

If an action is missing, disabled, or returns `AccessDenied`, first check the selected workspace and context. The UI does not widen storage permissions; IAM and S3 remain the source of truth.

## First login checklist: storage user

- Sign in and confirm whether **Portal** or **Browser** is available.
- In Portal, open **Storage Spaces** and choose the space assigned to your work.
- In Browser, select the expected account or connection, then open a bucket.
- Upload and download a small test object when your role allows it.
- If access is missing, report the workspace, account/context, bucket or Storage Space, and exact error text.

## First login checklist: storage administrator

- Open **Admin** and verify the storage endpoint health.
- Confirm the first account or connection is visible in the topbar context selector.
- Open **Manager**, create or inspect a bucket, and check IAM access when available.
- Open **Browser** from the same context to validate object-level access.
- Review audit, usage, quota, or endpoint status pages before handing the workspace to users.

## Expected result

You know which workspace to use and can start from the correct context.

## Limits / access

!!! note
    Workspace visibility depends on role, account links, connection access flags,
    Portal account roles, Ceph Admin or Storage Ops entitlements, context
    availability, and endpoint capabilities. IAM and S3 still decide whether
    the visible action succeeds.

## Related pages

- [Common tasks for storage users](common-tasks-storage-user.md)
- [Common tasks for storage administrators](common-tasks-storage-admin.md)
- [Workspace: Portal](workspace-portal.md)
- [User profile](profile.md)
- [Troubleshooting](troubleshooting.md)

## What to read next

- For file work, continue with [Workspace: Browser](workspace-browser.md) or [Feature: Object operations in Browser](feature-objects-browser.md).
- For self-service storage, continue with [Workspace: Portal](workspace-portal.md).
- For bucket and IAM administration, continue with [Workspace: Manager](workspace-manager.md).
- For platform setup, continue with [Workspace: Admin](workspace-admin.md).
- If a term is unclear, use [Glossary and search tips](glossary.md).

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/start-here.light.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/start-here.dark.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
</div>

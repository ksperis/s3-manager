# Portal: External S3 Tools

Use this page when an app, script, desktop client, or external partner cannot
work through the Portal directly.

When a collaborator can sign in to the Portal, share the space from the Portal
instead. Create tool access only when a direct storage client is the right
workflow.

## Before you start

- The External tools page is enabled for the selected project.
- You know which space the tool needs to reach.
- You know whether the tool is for you or for an external user.
- For an external user, you own the target space.
- You are ready to copy the secret when it is shown.

## Steps

1. Open **Portal > External tools**. This page exposes the S3 endpoint, bucket
   name, access key, and other technical connection details required by S3
   clients.
2. Read **Before connecting a tool** and confirm that Portal sharing is not a
   better fit.
3. Start **New tool access**.
4. Choose **For myself** or **For an external user**.
5. Choose the space the tool should reach.
6. Select **Read only** unless the tool must upload, replace, or delete files.
   Use **Read/write** only for tools that need those changes.
7. Copy the secret immediately. It is shown only once.
8. In **Connect an external tool**, choose the access entry and space.
9. Download either:
   - **Cyberduck bookmark** to open the space directly in Cyberduck;
   - **Connection details** for another S3-compatible client.
10. If you need a one-time file that also includes the secret, use the explicit
   **Details with secret** action immediately after creating the access, then
   delete the file after configuring the tool.
11. Disable or delete unused access when it is no longer needed.

## Important limits

- The Portal runtime access used by the application is intentionally hidden.
- The configured key limit applies to each IAM user. When your personal IAM
  user reaches it, **For myself** is unavailable, but an external access can
  still be created because it receives a separate IAM user.
- Personal tool access follows your current Portal space grants.
- Every tool identity must remain assigned to one person. Multiple personal
  keys are allowed during rotation, but never share a key between people.
- Portal itself already uses your personal IAM identity, so provider access
  logs can attribute Portal S3 requests to you. External access must preserve
  the same one-person attribution contract.
- External tool access is limited to one space and to the selected
  permission level.
- Tool access does not grant access outside the underlying storage policies.
- The bucket name is shown only because some S3-compatible tools ask for it.
  Use the space name everywhere else in Portal.
- Cyberduck bookmark files do not include the secret. Cyberduck asks for it
  when connecting.
- Cyberduck bookmarks automatically use path-style S3 addressing when the
  selected storage endpoint requires it.

## You are done when

The external tool can connect with the downloaded details and access only the
intended space with the selected permission level.

## If tool access creation is unavailable

Ask an admin whether External tools is enabled. If only **For myself** is
unavailable, delete an unused personal S3 access key before creating another.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Spaces](portal-storage-spaces.md)
- [Portal: Settings](portal-settings.md)
- [Feature availability](feature-availability.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-access-keys.light.png" alt="Portal External tools page with guidance for connecting a tool, one-time secret warning, and external access actions" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-access-keys.dark.png" alt="Portal External tools page with guidance for connecting a tool, one-time secret warning, and external access actions" loading="lazy">
</div>

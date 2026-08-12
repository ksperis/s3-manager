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
2. Start **New tool access**. The creation page explains when Portal sharing is
   a better fit.
3. Choose **For myself** or **For an external user**.
4. Choose the space the tool should reach.
5. Select **Read only** unless the tool must upload, replace, or delete files.
   Use **Read/write** only for tools that need those changes.
6. Copy the secret immediately. It is shown only once.
7. Select **Configure a tool** to continue with the identity that was just
   created. For an existing access, select **Connect** on its row or use the
   same action from **Connect tool**.
8. For an external recipient only, if you must transmit both values in one
   file, expand **Advanced: prepare credentials for secure transfer** and use
   **Export unencrypted credentials (.txt)**. Confirm the warning, use a
   secure transfer channel, and delete every copy after the recipient has
   configured the tool.
9. Choose the target space when the access is personal. An external access is
   already fixed to the space selected when it was created.
10. Choose the application and import its downloaded configuration:
   - **Cyberduck / Mountain Duck** uses a `.duck` bookmark on macOS and
     Windows;
   - **WinSCP** uses an S3 session `.ini` on Windows;
   - **rclone** is available under **Advanced tools and manual setup** and uses
     a `.conf` remote for command-line work and automation;
   - another S3-compatible application can use the endpoint, bucket, Access ID,
     and addressing mode displayed in the same advanced section.
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
- The `.duck`, WinSCP `.ini`, rclone `.conf`, and manual `.txt` files downloaded
  from **Connect a tool** never include the secret. The application asks for it
  when connecting.
- Personal access never offers a secret-inclusive download. The exceptional
  unencrypted export is shown only immediately after creating an external
  recipient's access and requires explicit confirmation.
- Cyberduck / Mountain Duck bookmarks, WinSCP sessions, and rclone remotes
  automatically use path-style S3 addressing when the selected storage
  endpoint requires it.
- rclone reads the secret from the environment variable shown beside the
  generated remote. Keep that value out of the `.conf` file.
- If no active access or no space is available, **Connect a tool** provides the
  next action instead of showing an unusable form.

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
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-access-keys.light.png" alt="Connect a tool dialog with human-readable access, Space selection, Cyberduck and WinSCP configuration cards" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-access-keys.dark.png" alt="Connect a tool dialog with human-readable access, Space selection, Cyberduck and WinSCP configuration cards" loading="lazy">
</div>

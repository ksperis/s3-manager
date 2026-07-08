# Portal: External Tools

Use this page when you need S3 credentials for yourself or for a limited
external user.

## Before you start

- Portal access-key creation is enabled for the selected account.
- You know whether the credential is for you or for another user.
- For an external user, you own the target space.
- You are ready to copy the secret when it is shown.

## Steps

1. Open **Portal > External tools**.
2. Review the endpoint guidance shown on the page.
3. Start **New key**.
4. Choose **For myself** or **For an external user**.
5. For an external user, choose the space and select **Read only** or
   **Read/write**.
6. Copy the secret immediately. It is shown only once.
7. In **Connect an external tool**, choose the key and space.
8. Download either:
   - **Cyberduck bookmark** to open the space directly in Cyberduck;
   - **Connection details** for another S3-compatible client.
9. If you need a one-time file that also includes the secret, use the explicit
   **Details with secret** action immediately after creating the key, then delete
   the file after configuring the tool.
10. Disable or delete unused keys when they are no longer needed.

## Important limits

- The Portal runtime key used by the application is intentionally hidden.
- User-managed keys may have a maximum count set by admins.
- Personal keys follow your current Portal space grants.
- External credentials are limited to one space and to the selected
  permission level.
- Access keys do not grant access outside the underlying storage policies.
- The bucket name is shown only as the name an external S3 tool asks for. Use
  the space name everywhere else in Portal.
- Cyberduck bookmark files do not include the secret. Cyberduck asks for it
  when connecting.

## You are done when

The external client can connect to the documented endpoint and access only the
intended space with the selected permission level.

## If key creation is unavailable

Ask an admin whether Portal user access-key creation is enabled and whether your account reached the maximum number of user-managed keys.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Spaces](portal-storage-spaces.md)
- [Portal: Settings](portal-settings.md)
- [Feature availability](feature-availability.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/portal-access-keys.light.png" alt="Portal External tools page with endpoint guidance, one-time secret warning, and external key actions" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/portal-access-keys.dark.png" alt="Portal External tools page with endpoint guidance, one-time secret warning, and external key actions" loading="lazy">
</div>

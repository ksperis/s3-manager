# Workspace: Portal

## When to use

Use **Portal** for an end-user workspace focused on spaces, files,
collaborators, activity, transfers, usage, alerts, storage-admin requests, and
simple preferences.

## Prerequisites

- The global `portal_enabled` setting is enabled.
- The global `browser_enabled` and `browser_portal_enabled` settings are
  enabled to browse files inside a space.
- Your UI user is explicitly linked to a Portal project.
- The project is backed by a storage service configured by the platform team.

## Steps

1. Open `/portal`.
2. Select the project in the top bar.
   - The selected project is recorded in `?project=`. Each open Portal tab uses
     the project shown in its own URL.
3. Use **Home** for the dashboard, quota, usage by space, collaborators,
   active external tool access, recent activity, shared spaces, transfers, and
   simple alerts.
4. Use **Spaces** to create or open a space, browse files when content access
   is available, upload, download, and invite collaborators.
   When an administrator enables Browser workspace access for the project, you
   can also open `/browser` with that project context; internal bucket names
   stay hidden.
5. Use **External tools** to generate S3 credentials for external tools. The
   Portal runtime key is not shown in this list.
6. Use **Collaborators** to review workspace members, spaces shared with you,
   people you invited, and public links when enabled.
7. Use **History** and **Storage health** for collaboration history, file
   movement, technical access logs when allowed, storage health, and cost
   checks.
8. Use **Help requests** to follow requests for missing collaborators, user
   removal, or storage-limit changes.
9. Use **Settings** to review the selected project's access, storage service,
   Storage Spaces, and current usage.

## Main workflows

| Workflow | Read next | What it covers |
|---|---|---|
| Open, create, import, or archive a space | [Portal: Spaces](portal-storage-spaces.md) | Access modes, active/archived states, creation, and imports. |
| Browse, upload, download, or inspect files | [Portal: Files](portal-files.md) | Object list, folders, safe details, and Portal-specific limits. |
| Share with collaborators or understand roles | [Portal: Collaborators](portal-sharing.md) | Viewer, Editor, Manager, public links, and archived-space behavior. |
| Create credentials for external S3 tools | [Portal: External tools](portal-access-keys.md) | One-time secrets, endpoint guidance, and hidden runtime keys. |
| Understand room left, growth, movement, and alerts | [Portal: Storage Health](portal-usage-alerts.md) | Storage used, per-space usage, trends, costs, and unavailable metrics. |
| Follow admin-help requests | [Portal: Help Requests](portal-requests.md) | Missing collaborators, user removal, storage-limit changes, statuses, and admin messages. |
| Review recent changes | [Portal: Activity](portal-activity.md) | Portal-visible space and file events. |
| Follow file operations | [Portal: Transfers](portal-transfers.md) | Queued, running, completed, and failed transfers. |
| Review project settings | [Portal: Settings](portal-settings.md) | Read-only project context, access level, storage service, and usage. |

## Portal model in one minute

- **Spaces** are the user-facing work areas registered in Portal. They may map
  to buckets internally, but buckets that are not registered as Portal spaces
  stay hidden from Portal lists.
- **Private** spaces are visible to their owner and Portal managers. Portal
  managers have full UI and file access and can explicitly take ownership.
- **Team** spaces are shared with current and future Portal members of the
  selected project. **Selected people** spaces are shared only with selected
  collaborators with Viewer or Editor grants. Team spaces have no owner.
- Both Portal roles can create private spaces when private Storage Space
  creation is enabled. Only Portal managers can create or import team spaces.
- **Archived** spaces stay registered but suspend file browsing, sharing, and public links until restored.
- **Storage health** can show the project total and quota. For regular Portal
  users, space details, activity, and transfers are limited to spaces
  they can access; undisclosed usage can appear only as the anonymous `Other`
  aggregate.
- File browsing inside a space uses a locked Portal profile of Browser. Advanced object inspection stays in Browser or Manager.
- `/browser` can also run with a Portal project context when the effective
  project setting `browser_access_enabled` is enabled. It still uses the
  personal IAM identity and Portal permissions instead of management controls.
- Portal roles come from a private owner, the manager project role, the team access mode, and
  collaborator grants managed in Portal. External S3 keys are synchronized from
  those records; IAM is not the source of Portal listings or roles.
- The dashboard **Collaborators** KPI counts active workspace members for the
  selected project and shows how many active external tool accesses exist for
  the storage spaces visible to you.
- Help requests let Portal users ask admins for project membership, user
  removal, or storage-limit changes. They do not change access or limits until
  an admin approves them.

## Expected result

Portal actions stay user-oriented and use the Portal space registry and
collaborator grants as their source of truth.

## Limits / feature flags

!!! note
    Portal roles are independent from Manager access. Portal access does not
    grant `/manager`; `/manager` still requires the appropriate project
    administration rights.

!!! note
    Portal requires `portal_enabled` and an explicit project link. File browsing
    inside spaces also requires `browser_enabled` and
    `browser_portal_enabled`. Standalone `/browser` access additionally requires
    the project's effective `browser_access_enabled` setting, which is disabled
    by default and does not affect file browsing inside Portal.

## Related pages

- [Portal: Spaces](portal-storage-spaces.md)
- [Portal: Files](portal-files.md)
- [Portal: Collaborators](portal-sharing.md)
- [Portal: External tools](portal-access-keys.md)
- [Portal: Storage Health](portal-usage-alerts.md)
- [Portal: Help Requests](portal-requests.md)
- [Portal: Activity](portal-activity.md)
- [Portal: Transfers](portal-transfers.md)
- [Portal: Settings](portal-settings.md)
- [Workspace: Browser](workspace-browser.md)
- [Use cases for storage users](use-cases-storage-user.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-portal.light.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-portal.dark.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
</div>

# Portal: Help Requests

Use this page when you need help from a storage admin before you can finish a
Portal task, add or remove someone from the project, or change the project
storage limit.

## Before you start

- The selected project is the project concerned by the request.
- You know the person's name and email when requesting project access for them.
- For storage-limit changes, you know the target capacity and why the project needs
  more or less room.

## Main tasks

1. Open **Portal > Help requests**.
2. Review **My help requests** first to see pending, approved, rejected, or
   failed requests.
3. Select **Add someone** when a collaborator is missing from the picker on
   **Portal > Collaborators**.
4. Select **Remove someone** when a user should no longer belong to the selected
   project.
5. Select **Change storage limit** to choose a higher or lower limit, enter the
   new target, choose the unit, and explain the reason. The preview shows the
   current limit, the requested limit, and the space already used.
6. Review the request list to follow its status.
7. Open request details to read admin messages, execution errors, or the final
   result.

## Statuses

| Status | Meaning |
|---|---|
| Pending | The request is waiting for an admin decision. |
| Processing | An admin approved it and the platform is applying the change. |
| Approved | The requested action completed successfully. |
| Rejected | An admin declined the request. |
| Failed | The platform could not apply an approved request. |

## Expected result

The request stays visible from Portal with admin messages and final status.
Approving a request is an Admin action: project membership and storage limits
are not changed until an admin validates the request.
Portal blocks storage-limit requests that would set the new limit below the
space already used.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Collaborators](portal-sharing.md)
- [Portal: Storage Health](portal-usage-alerts.md)

## Visual example

This page reuses the Portal dashboard screenshot because it shows the Help requests entry point and the surrounding Portal context.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-portal.light.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, help requests, and alerts" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-portal.dark.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, help requests, and alerts" loading="lazy">
</div>

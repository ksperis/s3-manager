# Portal: Requests

Use this page when you need help from a storage admin before you can finish a
Portal task, add or remove someone from the project, or change the project
quota.

## Before you start

- The selected project is the project concerned by the request.
- You know the person's name and email when requesting project access for them.
- For quota changes, you know the target capacity and why the project needs
  more or less room.

## Main tasks

1. Open **Portal > Requests**.
2. Review **My requests** first to see pending, approved, rejected, or failed
   requests.
3. Use **Add someone to this project** when a collaborator is missing from the
   picker on **Portal > Collaborators**.
4. Use **Remove someone from this project** when a user should no longer belong
   to the selected project.
5. Use **Change project storage limit** to choose a higher or lower limit, enter
   the new target, choose the unit, and explain the reason. The quota preview
   shows the current quota, the requested quota, and the space already used.
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
Portal blocks quota requests that would set the new limit below the space
already used.

## Related pages

- [Workspace: Portal](workspace-portal.md)
- [Portal: Collaborators](portal-sharing.md)
- [Portal: Storage Health](portal-usage-alerts.md)

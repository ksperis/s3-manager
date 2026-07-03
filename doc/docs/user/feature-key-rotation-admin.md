# Feature: Key Rotation in Admin

Use this page when you need to rotate managed storage credentials from Admin.

## When to use

Use **Admin > Settings > Key Rotation** for planned credential rotation, incident response, or validation of endpoint credential hygiene.

## Prerequisites

- `ui_superadmin` access.
- At least one eligible storage endpoint.
- A maintenance window or rollout plan when rotated keys are used by automation.
- A fallback credential or recovery path is known.

## Steps

1. Open **Admin > Settings > Key Rotation**.
2. Select the endpoint or endpoints to rotate.
3. Select only the key types required by the maintenance plan.
4. Confirm the operation and wait for the result.
5. Validate endpoint health, Manager context access, Browser access, and any scheduled collection job that uses the rotated credential.
6. Review audit logs for the actor, endpoint, and key type.

## Expected result

Managed credentials are rotated and dependent storage workflows still pass health, usage, and Browser checks.

## You are done when

The rotation result is successful, audit evidence exists, and a post-rotation smoke test passes for every selected endpoint.

## If you do not see this action

Only superadmins can access key rotation. Check role assignment before checking storage endpoint settings.

## Limits / feature flags

!!! warning
    Key rotation can interrupt automation that still depends on an old credential. Validate schedulers, CronJobs, external integrations, and backup access after rotation.

## Related pages

- [Workspace: Admin](workspace-admin.md)
- [Ops / Security](../ops/operations-security.md)
- [Ops / Production readiness](../ops/production-readiness.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

This page reuses the Admin workspace screenshot because key rotation is a superadmin settings workflow inside Admin.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-admin.light.png" alt="Admin workspace with platform-level navigation" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-admin.dark.png" alt="Admin workspace with platform-level navigation" loading="lazy">
</div>

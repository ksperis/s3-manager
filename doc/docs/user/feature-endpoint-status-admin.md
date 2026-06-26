# Feature: Endpoint Status in Admin

## When to use

Use this page when you need a global healthcheck view across the storage endpoints managed by the platform.

## Prerequisites

- `ui_admin` or `ui_superadmin` role.
- `endpoint_status_enabled=true` in general settings.

## Before you start

Use Endpoint Status as a triage page. It tells you which endpoint needs attention, then Ops pages and backend logs explain why.

## Steps

1. Open `/admin/endpoint-status`.
2. Use the global status cards to focus on `Up`, `Degraded`, `Down`, or `Unknown` endpoints.
3. Review the latency overview to compare current, minimum, average, and maximum response times.
4. Use timelines and the incidents table to understand stability over time.
5. Use `Check now` when you need an immediate healthcheck refresh before investigating further.

!!! note
    In the latency overview, an orange current-latency bar means the current
    sample is significantly above the 24h average. It is a comparison signal,
    not an incident by itself; use the status pill and timeline for health
    state.

## Expected result

You can assess current backend health quickly and identify which endpoints require follow-up.

## You are done when

You can name the affected endpoint, current status, latest latency signal, and whether the issue is current or historical.

## If you do not see this action

Check `endpoint_status_enabled`, Admin access, and whether endpoints are configured for healthchecks.

## Limits / feature flags

!!! note
    This page is available only when the Endpoint Status feature is enabled in app settings.

## Related pages

- [Workspace: Admin](workspace-admin.md)
- [Ops / Operations: healthchecks](../ops/operations-healthchecks.md)
- [Troubleshooting](troubleshooting.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/admin-endpoint-status.light.png" alt="Admin Endpoint Status page with latency overview, health timelines, and recent incidents" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/admin-endpoint-status.dark.png" alt="Admin Endpoint Status page with latency overview, health timelines, and recent incidents" loading="lazy">
</div>

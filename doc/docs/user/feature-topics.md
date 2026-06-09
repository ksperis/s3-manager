# Feature: SNS Topics

## When to use

Use this guide to manage SNS topic resources from Manager.

## Prerequisites

- Access to `/manager/topics`.
- Endpoint SNS capability enabled.

## Steps

1. Open **Manager > SNS Topics**.
2. Create a topic.
3. Review topic subscriptions and Ceph RGW notification destinations.
4. Inspect topic attributes.
5. Edit or review topic policy.
6. Delete unused topics.

## Expected result

SNS topics are managed within the selected manager context.
For Ceph RGW endpoints, notification bindings returned as `notif.*` entries are
shown as destinations under their parent topic instead of separate topics.

## Limits / feature flags

!!! note
    SNS menu is shown only when endpoint capability `sns` is enabled.

## Related pages

- [Workspace: Manager](workspace-manager.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/feature-topics.light.png" alt="SNS Topics feature page with topic actions" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/feature-topics.dark.png" alt="SNS Topics feature page with topic actions" loading="lazy">
</div>

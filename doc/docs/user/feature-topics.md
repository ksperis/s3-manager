# Feature: SNS Topics

## When to use

Use this guide to manage SNS topic resources from Manager.

## Prerequisites

- Access to `/manager/topics`.
- Endpoint SNS capability enabled.

## Before you start

Confirm that the selected endpoint supports SNS. Topics and bucket notification bindings are endpoint-specific and should be reviewed in the same Manager context.

## Steps

1. Open **Manager > SNS Topics**.
2. Create a topic.
3. Review topic subscription counters.
4. Inspect topic attributes.
5. Edit or review topic policy.
6. Delete unused topics.

## Expected result

SNS topics are managed within the selected manager context.
The **Subscriptions** column uses the SNS `Confirmed` and `Pending` counters
for every compatible endpoint. For Ceph RGW endpoints, duplicate raw topic
entries that share the same topic ARN are folded into one topic row.

## You are done when

The topic list, subscription counters, attributes, and policy match the intended event workflow.

## If you do not see this action

Check endpoint capability `sns`, Manager access, and whether bucket notification configuration is supported for the target context.

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

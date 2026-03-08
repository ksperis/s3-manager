# Feature: Bucket Compare

## When to use

Use this guide when you need to compare bucket states before migration or remediation.

## Prerequisites

- Access to `/manager/bucket-compare`.
- `bucket_compare_enabled` set to true.
- Context with bucket management capability.

## Steps

1. Open **Manager > Tools > Compare**.
2. Select source and target bucket scope.
3. Run comparison.
4. Review differences and proposed remediation actions.
5. Apply remediation actions only after validation.

## Expected result

You get an actionable diff view to support controlled bucket alignment.

## Limits / feature flags

!!! note
    Tool visibility depends on global feature flag and context requirements.

## Related pages

- [Workspace: Manager](workspace-manager.md)
- [Feature: Bucket migration](feature-bucket-migration.md)

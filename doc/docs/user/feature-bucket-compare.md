# Feature: Bucket Compare

## When to use

Use this guide when you need to compare bucket states before migration or remediation.

## Prerequisites

- Access to `/manager/bucket-compare`.
- `bucket_compare_enabled` set to true.
- A UI user with **Manager tools > Bucket compare** access enabled.
- Context with bucket management capability.

## Steps

1. Open **Manager > Tools > Compare**.
2. Select source and target bucket scope.
3. Optionally set **Ignore objects modified after** to exclude recently changed objects from the diff and remediation scope.
4. Run comparison.
5. Expand only the result rows you need to inspect; results stay collapsed by default.
6. Review object-level details: key, size, modification date, ETag, storage class, Browser links, and direct download actions.
   Browser links open in a new tab so the comparison result stays available.
7. Apply remediation actions only after validation.

## Expected result

You get an actionable diff view to support controlled bucket alignment. Manager
remediation actions apply only the exact object keys present in the current
content diff section or object row.

## Limits / feature flags

!!! note
    Tool visibility depends on the global feature flag, per-user Manager tool access, and context requirements.

## Related pages

- [Workspace: Manager](workspace-manager.md)
- [Feature: Bucket migration](feature-bucket-migration.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/feature-bucket-compare.light.png" alt="Bucket compare result showing detected differences and remediation actions" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/feature-bucket-compare.dark.png" alt="Bucket compare result showing detected differences and remediation actions" loading="lazy">
</div>

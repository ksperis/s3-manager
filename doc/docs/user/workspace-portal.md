# Workspace: Portal

## When to use

Use **Portal** for an end-user Storage Workspace focused on storage spaces,
sharing, activity, transfers, usage, alerts, and simple preferences.

## Prerequisites

- The global `portal_enabled` setting is enabled.
- Your UI user is explicitly linked to the account with Portal access.
- The account is backed by a storage endpoint configured by the platform team.

## Steps

1. Open `/portal`.
2. Select the portal account context in the top bar.
3. Use **Home** for the dashboard, quota, usage by Storage Space, recent
   activity, shared spaces, transfers, and simple alerts.
4. Use **Storage Spaces** to open an assigned space, browse files, upload,
   download, and share with collaborators.
5. Use **Shares** to review items shared with you, items shared by you, and
   public links when enabled.
6. Use **Activity**, **Transfers**, and **Usage & Analytics** for collaboration
   history and consumption tracking.
7. Use **Settings** for simple account and preference changes.

## Expected result

Portal actions stay user-oriented and use the storage permissions configured by
the platform as the source of truth.

## Usage, alerts, and availability

Portal metrics are scoped to the selected Portal account and use bytes for
storage and traffic values. Object counts are counts reported by the storage
backend.

- **Storage used** comes from the Portal usage API. When account-level usage is
  unavailable, Portal may use the sum of visible Storage Space usage. If neither
  source is available, the metric is shown as unavailable.
- **Quota** comes from the account quota exposed to Portal. If no quota is
  configured or metrics are disabled for the endpoint, Portal shows a clear
  unavailable state instead of treating the quota as unlimited.
- **Usage by Storage Space** is based on real per-space usage returned by the
  Portal usage API. When the backend cannot report per-space values, the chart
  is hidden behind an unavailable state.
- **Traffic and requests** come from traffic metrics for the selected account.
  If traffic collection is disabled or temporarily unavailable, Portal shows the
  last billing-derived values when available, otherwise an unavailable state.
- **Billing source** is optional. It appears only when billing is enabled and
  the selected account has billing data for the month.
- **Alerts** are deduplicated and ordered by severity. They can include quota
  near limit, public Storage Space or public link, expiring public link, failed
  transfer, and degraded storage endpoint signals.

## Limits / feature flags

!!! note
    Portal roles are independent from Manager access. Portal access does not
    grant `/manager`; `/manager` still requires the appropriate account
    administration rights.

!!! note
    Portal requires `portal_enabled` and an explicit account link. Advanced
    object inspection belongs in `/browser`, not inside Portal.

## Related pages

- [Workspace: Browser](workspace-browser.md)
- [Use cases for storage users](use-cases-storage-user.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/workspace-portal.light.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/workspace-portal.dark.png" alt="Portal Storage Workspace dashboard with usage, activity, shares, transfers, and alerts" loading="lazy">
</div>

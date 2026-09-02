# Product Design Guidelines

## Purpose

This document captures the product design contract for future interface work in
BucketReef.

Use it to decide:

- which workspace should own a feature;
- how dense or technical the screen should be;
- which shared UI patterns should be reused;
- which vocabulary belongs to each user surface;
- what to validate before shipping visible UI changes.

It complements, but does not replace:

- [Workspace surface separation](workspace-surface-separation.md), which defines
  routing, execution identity, and cross-surface contracts;
- [UI theme guidelines](ui-theme-guidelines.md), which defines tokens and
  primitive class usage;
- [AI assistant guidelines](ai-assistant-guidelines.md), which defines security,
  architecture, validation, and commit expectations.

## Product Direction

BucketReef is a work console for S3-compatible storage. It should feel calm,
dense, predictable, and operational. The UI should help users understand what
identity they are using, what storage scope they are acting on, and whether an
operation is native S3/IAM, platform governance, or end-user self-service.

Avoid marketing-style pages, decorative layouts, fake production data, and
workspace-specific visual themes when a shared product pattern fits.

## Design Principles

1. Start from the workspace contract.
   Place a feature in the narrowest workspace that matches the user's job and
   the required execution identity.

2. Keep S3 and IAM faithful.
   Manager and Browser features should expose native storage concepts clearly
   instead of simplifying them into a parallel permission model.

3. Protect Portal from operator complexity.
   Portal is for end users. It should use user-facing labels, avoid advanced
   S3/IAM vocabulary, and hide diagnostics that belong in Manager, Browser, or
   Admin.

4. Reuse shared primitives before styling locally.
   Start from `PageHeader`, `PageTabs`, `ListToolbar`, `PageControlStrip`,
   `ActiveFiltersBar`, `DataTableShell`, `WorkflowPage`, `Modal`, `UiButton`, and
   the shared `ui-*` classes before adding page-specific class chains.

5. Prefer progressive disclosure over busy first screens.
   Keep dashboards and list pages scannable. Move advanced filters, raw JSON,
   destructive actions, and technical detail into tabs, drawers, modals, or
   secondary sections when the workflow allows it.

6. Make unavailable states honest.
   If a backend capability, feature flag, account context, or storage permission
   is missing, show an empty or unavailable state. Do not invent realistic
   production data outside tests, docs screenshots, or isolated demos.

7. Validate real routes when runtime behavior matters.
   Unit tests and type checks are not enough for visible route behavior. Use a
   browser smoke or the docs visual QA scenarios for meaningful UI changes.

## Workspace Design Contracts

| Workspace | User job | Design posture | Preferred patterns | Avoid |
| --- | --- | --- | --- | --- |
| `/portal` | End-user storage workspace for files, shares, governance activity, usage, and personal settings. | Approachable, compact, user-facing, and bounded to visible Storage Spaces. | `PageHeader`, `WorkspaceDashboardKit`, `PageTabs variant="line"`, `PortalSettingsLayout`, locked `BrowserEmbed` with the `portal-basic` profile. | IAM jargon, ARNs, principals, policy JSON, bucket diagnostics, lifecycle, replication, versioning, `/portal/browser`, fake production data. |
| `/browser` | Advanced object explorer and object-operation workspace. | Task-first, technical, and explicit about selected execution context. | `BrowserPage`, `BrowserEmbed`, compact embedded profiles, advanced root profile only when access allows it. | Duplicate browser implementations, hidden context switching, advanced chrome for simple embedded surfaces. |
| `/manager` | S3 and IAM configuration console for accounts, connections, users, groups, roles, policies, buckets, and bucket features. | Dense, accurate, and native to S3/IAM semantics. | `PageHeader`, `PageTabs`, `DataTableShell`, `ListToolbar`, `BucketFeatureCard`, shared metrics and dashboard components. | Hiding native S3/IAM meaning, Portal wording, platform-governance settings that belong in Admin. |
| `/admin` | Platform governance for UI users, endpoints, accounts, feature flags, audit, billing, health, and global settings. | Administrative, auditable, and oriented around platform state. | `PageHeader`, settings panels, `WorkflowTabs`, shared association summaries, shared metrics cards. | Generic S3 object workflows, tenant operations without explicit governance context, local-only visual patterns. |
| `/ceph-admin` | Ceph RGW cluster administration for authorized operators. | High-signal, risk-aware, and explicit about endpoint-wide impact. | Ceph Admin shell, compact operational tables, risk acknowledgement for endpoint-wide Browser use. | Regular tenant file work, hiding owner/executor ambiguity, Portal or Manager shortcuts. |
| `/storage-ops` | Operational bucket tooling and cross-account maintenance. | Deterministic, compact, and action-oriented. | Shared bucket workbench, advanced filter drawer, selection action bar, progress cards. | Decorative cards, hidden filters that change backend semantics, UI-only filters without backend support. |

## Pattern Matrix

| Need | Default pattern | Notes |
| --- | --- | --- |
| Page title, description, breadcrumbs, and primary actions | `PageHeader` | Keep primary actions top-level only when they start the main workflow for the page. |
| Sibling page modes or metric sections | `PageTabs variant="line"` | Use the shared line baseline for top-level page navigation. Keep `bar` for compact embedded controls and `card` when the tab content is a contained tool. |
| Lists and inventory pages | `DataTableShell`, `ui-data-table`, `uiTableContainerClass` | Keep tables compact. Use explicit empty and unavailable states. |
| Search, filters, and column controls | `ListToolbar`, `PageControlStrip`, `ActiveFiltersBar`, shared compact toolbar classes | Advanced filters should not introduce frontend-only behavior unless the backend data is already present and bounded. |
| Cards, panels, and page sections | `uiCardClass`, `uiPanelClass`, `uiCardMutedClass`, `uiPanelMutedClass` | Standard cards use 8px radius and soft/no shadows. Avoid decorative nesting. |
| Forms and settings | `ui-control`, `uiLabelClass`, `UiCheckboxField`, `UiDetails`, settings panels | Compute dirty state from saveable fields only. |
| Long operations and large forms | `WorkflowPage`, `WorkflowTabs`, `WorkflowSection`, `WorkflowActions`, `workflowPageHostClass` | Replace the current list content with a focused in-page workflow. Keep the page header full-width so its actions stay aligned with listing pages; apply `width` only to the left-aligned content wrapper and never center the form body. |
| Dialogs, drawers, and overlays | `Modal`, shared menu classes, `AnchoredPortalMenu`, `useUnsavedChangesGuard` | Reserve overlays for short, contextual tasks. Editable overlays must protect unapplied changes on every close path. |
| Inline status, warnings, and capability gaps | `UiBadge`, `UiInlineMessage`, `PageBanner`, `PageEmptyState`, `MetricsUnavailableCard` | Distinguish missing data, disabled features, denied permissions, and unsupported backend capability. |
| Destructive or high-risk operations | Explicit confirmation plus backend safeguards and audit logs | Never rely on color or UI gating alone for safety. |
| Dashboards and metrics | Shared KPI, usage, traffic, and workspace dashboard components | Reuse chart language across Admin, Manager, Portal, and Ceph Admin while keeping labels surface-appropriate. |
| Browser inside another workspace | `BrowserEmbed` with a locked or compact profile | Embedded Browser should reduce chrome and preserve the parent workspace's job. |

## Page or modal decision

Use a focused page when the task has any of these characteristics:

- it runs long enough that progress, cancellation, retry, or a completion
  summary must remain visible;
- it contains multiple sections, tabs, validation groups, or enough fields to
  require scrolling;
- it is a bulk, destructive, import, purge, compare, integrity, or endpoint
  configuration workflow;
- the user benefits from a stable URL-sized surface, readable breadcrumbs, and
  room for supporting context.

Use a modal when the task is short and preserving the current page context is
more valuable than extra space. This includes confirmations, one-time secret
handoffs, compact create forms, small metadata edits, and Browser actions tied
to the current bucket, prefix, or object selection.

Do not keep a generic compatibility component that switches a workflow between
modal and page presentations. When the same form legitimately needs both,
factor the fields and business hook, then compose explicit `Modal` and
`WorkflowPage` wrappers at their call sites. Do not infer the presentation from
viewport size. When a workflow page is rendered inside an inventory component,
apply `workflowPageHostClass` to the host so the inventory is visually replaced
while confirmation modals can still appear above it.

## Vocabulary Rules

| Concept | Portal language | Manager or Browser language | Admin language |
| --- | --- | --- | --- |
| Bucket-like end-user area | Storage Space | Bucket | Account or storage resource, depending on governance context |
| Access level | Viewer, Editor, Owner, Manager | IAM policy, group, role, access key, bucket policy | UI user, UI group, feature access, account binding |
| File operations | Files, folders, uploads, downloads, shares | Objects, prefixes, metadata, versions, storage class | Usually out of scope unless auditing or governance requires it |
| Usage | Storage health, storage, transfers, billing source | Traffic, usage history, bucket usage, metrics | Usage history, billing, quota monitoring, platform health |
| Advanced configuration | Hidden from Portal | Lifecycle, replication, CORS, website, notification, policy, encryption | Feature flags, endpoint settings, governance and audit |

When in doubt, keep Portal copy user-facing and keep Manager/Browser copy
faithful to S3/IAM.

## Visual Tone

- Use the shared `shell-*` tokens for app chrome and `ui-*` tokens for workspace
  content.
- Standard workspace screens should be restrained, dense, and scannable.
- Keep page sections unframed unless a component is a repeated card, modal, or
  genuinely framed tool.
- Avoid gradients, large shadows, translucent effects, oversized rounded
  corners, and decorative illustration on operational screens.
- Do not introduce a new color language for one workspace unless the shared
  token model cannot represent the state.
- Maintain both light and dark mode behavior for visible shared components.

## New UI Checklist

Before implementing a new page or materially changing an existing page:

1. Identify the owning workspace and execution identity.
2. Confirm the feature is not crossing into another workspace's job.
3. Pick the existing page pattern closest to the workflow.
4. List the shared components and `ui-*` classes to reuse.
5. Define loading, empty, unavailable, denied, and error states.
6. Confirm labels match the surface vocabulary.
7. Preserve IAM/S3 semantics and backend permission checks.
8. Add targeted tests for behavior and regression risk.
9. Run type checks or focused frontend tests when code changes.
10. Use browser-level smoke or docs visual QA for meaningful route changes.

## Product Design Workflow

For broad redesign, new workspace concepts, or visual exploration:

1. Start with the current workspace contract and this guide.
2. Gather the visual source: existing route, screenshot, mockup, Figma frame, or
   generated concept.
3. Explore visual options before implementation when the target is not already
   clear.
4. Build against existing primitives instead of starting a parallel component
   system.
5. Validate the rendered result in desktop, mobile, light, and dark modes when
   the change affects a real workspace route.

Product Design references that are useful for future work include committed
screenshots under `doc/docs/assets/screenshots/`, the docs screenshot Playwright
scenarios, and the shared component files under `frontend/src/components/`.

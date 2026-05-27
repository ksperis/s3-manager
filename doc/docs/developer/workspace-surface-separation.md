# Workspace Surface Separation

## Purpose

The product exposes distinct workspaces for distinct jobs. A feature should be
placed in the narrowest surface that matches the user's intent and the required
execution identity.

## Surfaces

- `/portal` is the end-user Storage Workspace. It is centered on storage spaces,
  simple file operations, shares, activity, transfers, usage, alerts, and user
  preferences.
- `/browser` is the advanced object explorer. It owns bucket/object diagnostics,
  versions, metadata, tags, batch operations, advanced object actions, and
  technical S3 inspection workflows.
- `/manager` is the S3 and account configuration workspace. It owns native S3
  and identity configuration, bucket properties, policies, users, groups, roles,
  lifecycle, replication, notifications, and topics.
- `/admin` is the platform administration workspace. It owns UI users,
  endpoints, accounts, global quotas, billing administration, feature flags,
  audit, health, and governance.

## Portal Rules

- Keep Portal labels user-oriented: `Storage Spaces`, `Shares`, `Activity`,
  `Transfers`, `Usage & Analytics`, and `Settings`.
- Do not add a `/portal/browser` route or embed `BrowserEmbed` in Portal.
- Do not use Portal as a shortcut to Manager configuration.
- Do not expose policy documents, principals, ARNs, advanced ACLs, object
  diagnostics, bucket defaults, lifecycle, CORS, replication, or versioning in
  Portal UI text.
- Keep storage permissions backed by the existing storage-side permissions. UI
  roles such as `Viewer`, `Editor`, and `Owner` are presentation and workflow
  terms, not a parallel permission model.

## Routing Contract

Portal canonical routes are:

- `/portal`
- `/portal/storage-spaces`
- `/portal/storage-spaces/:spaceId`
- `/portal/storage-spaces/:spaceId/objects/*`
- `/portal/shares`
- `/portal/activity`
- `/portal/transfers`
- `/portal/usage`
- `/portal/settings`

Read-only mock administration pages may remain while Portal V3 is being
developed, but they must avoid advanced configuration and mutation semantics.

# User Documentation Improvement TODO

Audit date: 2026-06-26

Scope audited:

- Published site entry point: `https://ksperis.github.io/s3-manager/`
- Local MkDocs source: `doc/mkdocs.yml` and all `doc/docs/**/*.md` pages
- User screenshot maintenance rules and generated screenshot references
- Local validation commands:
  - `python3 -m mkdocs build --strict --config-file doc/mkdocs.yml --site-dir /private/tmp/s3-manager-docs-audit-build`
  - `npm --prefix frontend run docs:screenshots:check`

Current baseline:

- The published site responds and is generated with MkDocs Material.
- The local documentation has 62 Markdown pages, all referenced in the MkDocs navigation.
- The strict MkDocs build succeeds.
- The user guide is broad and covers the major surfaces: Admin, Manager, Portal, Browser, Ceph Admin, and Storage Ops.
- The current structure is mostly reference-oriented. It is useful once a user already understands the product, but it does not yet feel like a calm guided path for first-time users.

Known validation gaps:

- `npm --prefix frontend run docs:screenshots:check` currently fails because `doc/docs/user/feature-bucket-purge.md` has no themed screenshot block.
- MkDocs reports one warning for `doc/docs/ops/operations-security.md`: the relative link to `../../../.trivyignore` is left unchanged.

## Documentation Experience Principles

- Start from the user's intent, not the route tree.
- Keep Admin, Manager, Portal, Browser, Ceph Admin, and Storage Ops vocabulary distinct.
- Use plain language first, then show technical flags or routes only when they help.
- Prefer short task pages with a clear success state over dense reference pages.
- Put risk and permission requirements before destructive actions.
- Use real UI screenshots with captions that explain what the user should notice.
- Keep advanced architecture and implementation details in Developer or Ops pages, not in the main end-user path.

## P0 - Make the Current Documentation Trustworthy

- [ ] Add a dedicated screenshot scenario for Bucket purge, generate light/dark screenshots, and add the themed screenshot block to `doc/docs/user/feature-bucket-purge.md`.
- [ ] Decide whether the purge screenshot should show the selection screen, the confirmation modal, or the progress state. Prefer the confirmation modal because the typed phrase and impact summary are the most safety-critical user moment.
- [ ] Rerun `npm --prefix frontend run docs:screenshots:check` and keep it green.
- [ ] Replace the `.trivyignore` relative link in `doc/docs/ops/operations-security.md` with either inline path text or a stable repository link so the strict MkDocs build has no warnings.
- [ ] Rerun the strict MkDocs build and document the exact command in the final change.
- [ ] Review the screenshots gallery for stale captions after any screenshot regeneration.

## P1 - Create a Pleasant First-Run Path

- [ ] Rework `doc/docs/index.md` into a clearer landing page with audience entry points:
  - "I need to use storage"
  - "I manage buckets and IAM"
  - "I operate the platform"
  - "I administer Ceph RGW"
  - "I deploy or secure the app"
- [ ] Add a compact "choose your workspace" table to `doc/docs/user/start-here.md`:
  - user goal
  - workspace
  - first action
  - when to ask an admin
- [ ] Add a short explanation of the topbar selectors in `start-here.md`: workspace, account/context, endpoint, and why selecting the wrong context changes what actions are available.
- [ ] Add a first-login checklist for a storage user:
  - sign in
  - choose Portal or Browser
  - open a Storage Space or bucket
  - upload/download a small object
  - know where to request access
- [ ] Add a first-login checklist for a storage administrator:
  - verify endpoint health
  - create or select an account/context
  - create a bucket
  - verify access through Browser
  - review audit/usage pages
- [ ] Add "what to read next" links at the end of `start-here.md` based on role, not only a generic related-pages list.

## P1 - Build Task-Oriented Journeys

- [ ] Create a short "common tasks" page for storage users with one-line links to the right page:
  - browse files
  - upload or download files
  - recover a version
  - create an external access key
  - understand missing access
- [ ] Create a short "common tasks" page for storage administrators:
  - configure an endpoint
  - manage users and roles
  - manage buckets
  - inspect usage and quota
  - run safe bulk operations
  - troubleshoot access denied
- [ ] Add a "safe destructive operations" page or section covering delete, purge, migration, and bulk apply workflows with confirmation expectations and audit expectations.
- [ ] Add a "feature availability" matrix for users that explains feature flags and backend capabilities without forcing users to read Ops configuration first.
- [ ] Add examples using the same naming style as screenshots so users can connect text to the UI.
- [ ] Add short troubleshooting branches for common user-facing states:
  - workspace missing
  - bucket missing
  - action disabled
  - `AccessDenied`
  - metrics unavailable
  - object version not visible

## P1 - Split Portal Into Friendly User Pages

The Portal page is important but too dense for end users. Keep `workspace-portal.md` as the overview, then extract smaller pages.

- [ ] Create "Portal: Storage Spaces" for opening, creating, archiving, and understanding private/shared spaces.
- [ ] Create "Portal: Files" for browsing, uploading, downloading, folder creation, details, and preview limits.
- [ ] Create "Portal: Sharing" for Viewer, Editor, Owner, public links, archived-space behavior, and what to do when sharing is unavailable.
- [ ] Create "Portal: Access keys" for creating external S3 credentials, copying the one-time secret, using endpoint information, and understanding hidden runtime keys.
- [ ] Create "Portal: Usage and alerts" for quota, usage by Storage Space, traffic, requests, billing source, and unavailable states.
- [ ] Keep advanced IAM translation details out of the Portal user pages unless they directly answer "why can't I do this?"
- [ ] Link the Portal screenshots gallery entries from the relevant new Portal pages, not only from the gallery.

## P2 - Improve Existing Feature Pages

- [ ] Rewrite repetitive "When to use / Prerequisites / Steps / Expected result" pages into a more natural task format when the current template feels mechanical.
- [ ] Add a short "Before you start" block to pages that require special permissions or feature flags.
- [ ] Add "You are done when..." success criteria to each feature page.
- [ ] Add "If you do not see this action..." guidance to pages with feature-flag, role, or backend capability dependencies.
- [ ] Add safety callouts to destructive or bulk operations before the steps, not only in the limits section.
- [ ] Prefer user-facing terms in headings. Keep route names and flag names in notes or tables.
- [ ] Ensure every standard user page has exactly one themed screenshot block, unless it is intentionally a gallery page.
- [ ] Add captions below screenshots that explain the key decision or control, not just the screen name.

## P2 - Improve Ops Pages for Real Deployers

- [ ] Add an "after deploy" checklist to Docker Compose and Helm pages:
  - sign in
  - set admin secrets
  - configure first endpoint
  - create or import first account
  - run healthcheck
  - verify Browser/Portal flags
- [ ] Add a minimal production hardening checklist that links to security, configuration, and observability pages.
- [ ] Make configuration pages more scannable by separating "required", "recommended", and "optional" settings.
- [ ] Add a troubleshooting path from a user-facing error to the relevant Ops page.
- [ ] Keep the public image/tag policy in Ops, but add a short "which image should I use?" summary.

## P3 - Search, Navigation, and Glossary

- [ ] Add a glossary page for recurring concepts:
  - S3 account
  - S3 connection
  - endpoint
  - execution context
  - Storage Space
  - workspace
  - Portal role
  - Manager tool access
  - feature flag
- [ ] Add synonym-friendly wording on key pages so search finds common terms such as files, folders, access key, quota, sharing, delete, empty bucket, and permissions.
- [ ] Review page titles for consistency and friendliness. For example, prefer user-task labels where possible while preserving technical names where needed.
- [ ] Consider adding "next page" links inside long user journeys so navigation does not depend only on the left sidebar.
- [ ] Keep `doc/docs/developer/docs-maintenance.md` updated whenever pages are split or added.

## Definition of Done for This Documentation Improvement

- [ ] A new user can answer "where should I go?" from the home page and Start Here page in under two minutes.
- [ ] A storage user can follow a complete path for Portal or Browser without reading Admin/Ops docs.
- [ ] A storage administrator can follow a complete path for endpoint, account, bucket, access, and validation.
- [ ] Destructive workflows clearly show risk, permissions, confirmation, progress, and recovery limits before the user acts.
- [ ] Screenshots are current, clickable, and validated by `docs:screenshots:check`.
- [ ] `python3 -m mkdocs build --strict --config-file doc/mkdocs.yml --site-dir /private/tmp/s3-manager-docs-audit-build` passes without warnings.
- [ ] The public site navigation remains simple: user pages first, Ops second, Developer last.

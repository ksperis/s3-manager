# Workspace Portal UX Audit

Date: 2026-07-08

## Audit Scope

This audit reviews the current `/portal` experience from the perspective of a first-time, non-technical storage user who wants to create a collaborative place, upload files, and share them with internal or external collaborators.

The dashboard was captured as an entry point only. It is intentionally out of scope for implementation changes.

Evidence screenshots are in `screenshots/current/`.

## Captured Steps

1. `01-dashboard-entry.png`: Portal entry dashboard.
2. `02-spaces-list.png`: Storage Spaces list.
3. `03-create-space-form.png`: Create Storage Space form.
4. `04-space-detail-overview.png`: Space detail, settings, access, external tools.
5. `05-space-files-browser.png`: Space detail before file area enters the viewport.
6. `06-shares-shared-with-me.png`: Global Shares page, Shared with me.
7. `07-shares-create.png`: Global Shares page, Shared by me and create share.
8. `08-public-links.png`: Global Shares page, Public links.
9. `09-mobile-spaces-list.png`: Mobile Storage Spaces list.

## What Works

- The Portal already has a calm, consistent visual language, compact cards, and reusable table/form primitives.
- "Storage Spaces", "Files", "Shares", "Activity", and "Transfers" are more user-facing than S3 bucket/object language.
- Per-space access controls keep Viewer, Editor, and Owner language visible without exposing IAM policy documents.
- The locked Browser embed is a useful reuse point for file operations, and avoids creating a separate object browser.
- Mobile reflow keeps the Storage Spaces list usable and avoids horizontal overflow.

## UX Risks

1. The main journey is split across too many places.
   A new user has to infer that space creation starts on `Storage Spaces`, upload happens after opening a space, collaborator management lives both in the space detail and in `Shares`, and public links come from file context. The system has the pieces, but not a guided path.

2. The first create form does not match the collaboration goal.
   The representative Portal user can create a space, but the form immediately states "Only the owner can access this Storage Space." A user trying to create a shared project space must create first, then discover a later access step.

3. The detail page puts technical and administrative sections before files.
   Metrics, editable metadata, external S3 tool naming, and access controls appear above the file area. For a non-technical user, the file workspace is the reason they opened the space, but it sits below the fold.

4. Sharing vocabulary is fragmented.
   The UI uses "Access", "Shares", "Direct collaborators", "External reach", "Public links", "Storage Space access", and "Eligible Portal users" across adjacent screens. Each term is defensible, but together they increase the learning burden.

5. The global Shares page is account-centric, not task-centric.
   "Shared with me", "Shared by me", and "Public links" are useful inventory views, but creating a new collaboration starts from a blank selector and no strong context. It feels like managing records rather than inviting people to a space.

6. External sharing is hard to discover.
   The per-space card says there is 1 public link, but the global Public links tab is empty in the captured fixture because the list filters on shared owner spaces. Regardless of fixture cause, a user sees contradictory signals and no obvious way to create an external link from the Shares page.

7. "External tools" interrupts the core user story.
   Showing "Name to use in S3 tools" before the file area exposes an implementation detail early. It is valuable, but should be progressive and secondary.

8. Mobile keeps the content usable but does not reduce decision load.
   The mobile list stacks filters first, then cards. The primary "create, upload, share" story is still not obvious; it is just narrower.

## Accessibility Risks

- The main workflow depends heavily on tabs and select controls. Keyboard state should be retested after the redesign, especially in share management and create flows.
- Several compact labels are uppercase and low-density. They appear readable in the screenshot, but contrast and zoom behavior should be checked in browser validation.
- Public-link and collaborator empty states do not always explain next actions, which can be an accessibility issue for cognitive load and error recovery.
- The audit uses screenshots plus route smoke. It does not prove full WCAG compliance, screen-reader naming quality, or keyboard completion of every mutation.

## Redesign Direction

Keep the existing visual identity and primitives, but change the Portal philosophy from "simple S3 management" to "collaborative storage workspaces":

- Make `Storage Spaces` the primary workspace and rename the product language around spaces, files, and collaborators.
- Add a task strip on the Storage Spaces page: create a space, upload files, invite collaborators, create external link.
- Turn space creation into a project-like workflow: name, purpose, and "who should access this" in one focused panel. Keep restricted backend rules, but make the next step visible when immediate sharing is not available.
- Move files above technical/admin details on the space detail page. Keep settings, access, and external tools below the file workspace or behind progressive sections.
- Consolidate collaboration around a clearer "Collaborators" concept. Use "People", "Teams/account members", and "Public links" as plain categories.
- Keep the global Shares route as a collaboration center, but make it task-led: pick a space, invite people, review incoming spaces, and manage external links.
- Move S3 tool naming and access keys to progressive "Connect external tools" affordances rather than default content.
- Preserve backend grants and Portal authority. Do not infer access from IAM, and do not add Manager concepts to Portal.

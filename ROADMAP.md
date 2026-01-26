# ROADMAP — s3-manager

This roadmap reflects the current priorities of **s3-manager**.

The **absolute priority** is to stabilise and sanitise the existing codebase.
All forward-looking features (including S3 bucket migration mechanisms) are
**explicitly out of scope** for the current roadmap and are kept only as future ideas.

Guiding principle for the coming iterations:

> **Stabilise → Clarify → Structure → Document**

No functional expansion should happen before these steps are completed.

---

## Phase 0 — Sanitize & Stabilisation (ABSOLUTE PRIORITY)

**Objective**  
Make the current project reliable, predictable, and safe to evolve.

**Scope**
- Bug fixing only
- UX fixes and consistency improvements
- Technical debt reduction when it directly impacts correctness
- No new major features
- No speculative or large refactors

**Key goals**
- Fix known functional bugs
- Fix broken or confusing UX flows
- Remove implicit or surprising behaviour
- Align frontend and backend error handling
- Improve code readability where it helps maintenance

**Deliverables**
- Stable `v0.1.x` baseline
- Initial `CHANGELOG.md`
- Significantly reduced number of open bugs
- Clean foundation for future phases

---

## Phase 1 — Authentication & Initial Access Clarification

**Objective**  
Make authentication and first-login behaviour explicit, secure, and understandable.

**Topics**
- Clarify the role of the initial “seed” user
- Remove implicit development shortcuts in production
- Explicit separation between:
  - development / demo mode
  - production mode

**Expected outcomes**
- No prefilled credentials in production
- Predictable first-login experience
- Clear authentication error messages
- Documented authentication model

---

## Phase 2 — Portal UX Consistency

**Objective**  
Make the Portal usable and coherent for `portal_manager` users without adding new features.

**Topics**
- Clarify the distinction between:
  - dashboard / overview pages
  - operational pages
- Improve navigation clarity
- Reduce ambiguity in naming and layout

**Expected outcomes**
- Clear and stable navigation
- Reduced cognitive load for portal users
- Improved day-to-day usability

---

## Phase 3 — Onboarding & First-Use Experience

**Objective**  
Reduce friction for new installations and first-time users.

**Topics**
- Explicit onboarding flow for initial configuration
- Clear indication of required vs optional setup steps
- Visibility on “what to do next” after first login

**Expected outcomes**
- Guided initial setup
- No “blank page” or unclear states
- Better self-service experience

---

## Phase 4 — Documentation & Reference Material

**Objective**  
Make documentation a first-class part of the project.

**Topics**
- Public documentation published from the repository
- Clear separation by surface (`/admin`, `/manager`, `/portal`, `/browser`)
- Architecture and invariants explicitly documented
- Documentation usable as a reference for both humans and AI tools

**Expected outcomes**
- Easier onboarding for contributors
- Reduced need to read the code to understand behaviour
- Clear long-term project narrative

---

## Future Ideas (Not Planned)

The following topics are intentionally **out of scope** for the current roadmap
and documented only as ideas for later consideration:

- S3 bucket migration mechanisms
- Cross-backend data copy workflows
- Worker-based asynchronous copy processes
- Server-side S3 copy optimisations
- Large-scale or multi-account migrations

These ideas must not influence current implementation or TODO items.

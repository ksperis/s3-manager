# TODO — s3-manager

This TODO list is intentionally focused on **stabilisation and clarification only**.

No future-oriented features should be added here until the stabilisation phases
are fully completed.

---

## Sanitize / Bug Fixing

- [ ] Fix known frontend bugs affecting navigation and state consistency
- [ ] Fix backend errors producing unclear or misleading responses
- [ ] Align frontend error messages with backend error semantics
- [ ] Remove unused or dead code where it causes confusion
- [ ] Review logs to ensure no sensitive data can leak

---

## UX & Consistency

- [ ] Fix confusing UI flows
- [ ] Harmonise naming across pages and menus
- [ ] Ensure similar actions behave consistently across surfaces
- [ ] Remove surprising default behaviours

---

## Authentication & Security

- [ ] Remove prefilled login credentials in production
- [ ] Make dev/demo shortcuts explicitly opt-in
- [ ] Clarify and document the role of the seed user
- [ ] Improve authentication error feedback
- [ ] Review access control edge cases

---

## Portal UX Cleanup

- [ ] Review Portal navigation structure
- [ ] Clarify dashboard vs operational pages
- [ ] Improve readability of Portal pages
- [ ] Remove unused or misleading Portal elements

---

## Onboarding

- [ ] Identify missing guidance during first login
- [ ] Add clear messages for incomplete configuration
- [ ] Prevent access to unclear or broken states during initial setup

---

## Documentation

- [ ] Add initial `CHANGELOG.md`
- [ ] Document the current authentication model
- [ ] Document surface responsibilities and boundaries
- [ ] Add contributor notes for the stabilisation phase

---

## Explicitly Out of Scope

- New functional features
- Migration mechanisms
- Performance optimisations not related to bug fixing

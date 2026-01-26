
# Portal surface

The Portal surface is optional and intended for managed workflows.

## Goals (typical)

- simplified onboarding flows
- controlled provisioning (guardrails)
- organization-specific UX

## Current state

The Portal is conditionally enabled on the backend (see `backend/app/main.py` dependencies).

Backend models include:

- `backend/app/models/portal.py`

If your roadmap includes a significant Portal revamp, treat documentation as a living artifact:
document *intent* + *current behavior*, and keep both explicit.

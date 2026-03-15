# Architecture: Backend

## Location

- Main entrypoint: `backend/app/main.py`
- Routers: `backend/app/routers/`
- Services: `backend/app/services/`

## Router groups

- Auth/users
- Admin
- Manager
- Browser
- Ceph Admin
- Internal cron endpoints

## Feature gating

Router dependencies enforce global feature enablement (`require_*_enabled`).

## Error behavior

Backend preserves storage/API denial semantics and logs server-side details.

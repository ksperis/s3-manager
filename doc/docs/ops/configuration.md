# Configuration

Configuration is split between backend environment variables and UI settings.

## Backend runtime settings

Primary source of truth: `backend/app/core/config.py`.

Key areas:

- Security and auth: JWT keys, credential keys, refresh cookie settings.
- Database: `DATABASE_URL`.
- CORS: `CORS_ORIGINS`.
- Feature force-locks: `FEATURE_MANAGER_ENABLED`, `FEATURE_BROWSER_ENABLED`, `FEATURE_PORTAL_ENABLED`, `FEATURE_CEPH_ADMIN_ENABLED`, `FEATURE_BILLING_ENABLED`, `FEATURE_ENDPOINT_STATUS_ENABLED`.
- Internal scheduler auth: `INTERNAL_CRON_TOKEN`.
- Billing and healthcheck behavior.

## App settings (persisted)

Primary model: `backend/app/models/app_settings.py`.

Managed from Admin UI:

- General feature toggles (`manager_enabled`, `browser_enabled`, `portal_enabled`, `ceph_admin_enabled`, `billing_enabled`, `endpoint_status_enabled`).
- Browser sub-flags (`browser_root_enabled`, `browser_manager_enabled`, `browser_portal_enabled`, `browser_ceph_admin_enabled`).
- Migration/compare flags and portal behavior.

## Frontend runtime settings

- `VITE_API_URL` for API base URL in frontend build/runtime.
- In container deployments, route `/api` to backend via reverse proxy/ingress.

## Branding

Admin can set:

- primary accent color (`#RRGGBB`)
- optional login logo URL

## Related pages

- [Operations: security](operations-security.md)
- [Developer: identity and execution model](../developer/identity-and-execution-model.md)

# Configuration

Configuration is split between backend environment variables and UI settings.

## Backend runtime settings

Primary source of truth: `backend/app/core/config.py`.

Key areas:

- Security and auth: JWT keys, credential keys, refresh cookie settings, OIDC providers, LDAP providers.
- Database: `DATABASE_URL` (SQLite defaults to `backend/app.db`; relative SQLite paths are normalized against `backend/`).
- CORS: `CORS_ORIGINS`.
- Feature force-locks: `FEATURE_MANAGER_ENABLED`, `FEATURE_BROWSER_ENABLED`, `FEATURE_CEPH_ADMIN_ENABLED`, `FEATURE_STORAGE_OPS_ENABLED`, `FEATURE_BILLING_ENABLED`, `FEATURE_ENDPOINT_STATUS_ENABLED`.
- Internal scheduler auth: `INTERNAL_CRON_TOKEN`.
- Billing, quota monitoring, and healthcheck behavior.
- Shared history retention: `BILLING_DAILY_RETENTION_DAYS`, `QUOTA_HISTORY_HOURLY_RETENTION_DAYS`, `QUOTA_HISTORY_DAILY_RETENTION_DAYS`.
- Quota SMTP secret: `SMTP_PASSWORD`.

LDAP providers are configured with nested environment variables:

- `LDAP_PROVIDERS__<key>__DISPLAY_NAME`
- `LDAP_PROVIDERS__<key>__URL` (`ldaps://...` or `ldap://...` with `START_TLS=true`)
- `LDAP_PROVIDERS__<key>__BIND_DN` / `LDAP_PROVIDERS__<key>__BIND_PASSWORD`
- `LDAP_PROVIDERS__<key>__USER_BASE_DN`
- `LDAP_PROVIDERS__<key>__USER_FILTER` containing `{username}`
- optional attributes: `EMAIL_ATTRIBUTE`, `NAME_ATTRIBUTE`, `SUBJECT_ATTRIBUTE`
- TLS and safety knobs: `START_TLS`, `TLS_VERIFY`, `TLS_CA_FILE`, `ALLOW_INSECURE`, `ALLOW_EMAIL_LINKING`

Provider keys must match `[a-z0-9_-]+`. `ALLOW_INSECURE=true`,
`TLS_VERIFY=false`, and `ALLOW_EMAIL_LINKING=true` are startup-warning
conditions and should be limited to isolated labs or planned migrations.

LDAP only authenticates the UI identity. First LDAP login creates a user with
`ui_none`; admins still grant roles and storage access in s3-manager.

## App settings (persisted)

Primary model: `backend/app/models/app_settings.py`.

Managed from Admin UI:

- General feature toggles (`manager_enabled`, `browser_enabled`, `ceph_admin_enabled`, `storage_ops_enabled`, `billing_enabled`, `endpoint_status_enabled`).
- Quota supervision toggles (`quota_alerts_enabled`, `usage_history_enabled`).
- Browser sub-flags (`browser_root_enabled`, `browser_manager_enabled`, `browser_ceph_admin_enabled`).
- Migration/compare flags and manager behavior.
- Quota notification policy (`quota_notifications`: threshold, SMTP non-secret fields, contact-email option).

## Frontend runtime settings

- `VITE_API_URL` for API base URL in frontend build/runtime.
- In container deployments, route `/api` to backend via reverse proxy/ingress.

## Branding

Admin can set:

- primary accent color (`#RRGGBB`)
- optional login logo URL

## Related pages

- [Operations: security](operations-security.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)
- [Developer: identity and execution model](../developer/identity-and-execution-model.md)

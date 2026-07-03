# Configuration

Configuration is split between backend environment variables and UI settings.

## Configuration checklist

| Priority | Configure | Why |
|---|---|---|
| Required | `DATABASE_URL`, JWT secrets, credential encryption key, `CORS_ORIGINS`, frontend API routing | The app must persist data, protect sessions and stored credentials, and accept requests only from the intended UI origin. |
| Required | `INTERNAL_CRON_TOKEN` when scheduler or CronJobs are enabled | Internal automation endpoints must not be callable without the shared token. |
| Recommended | OIDC or LDAP provider settings | Enterprise identity is safer and easier to operate than local-only users. |
| Recommended | Feature flags for Manager, Portal, Browser, Ceph Admin, Storage Ops, billing, endpoint status, usage history, and quota alerts | Users should see only the surfaces that are intentionally launched. |
| Recommended | Healthcheck, billing, quota, and usage-history schedules and retention | Operational data should be fresh enough to support troubleshooting and capacity decisions. |
| Recommended | SMTP settings when quota alerts are enabled | Quota alerts need a deliverable notification path. |
| Optional | Branding color and login logo | Useful for tenant or lab identity, but not required for safe operation. |

## Backend runtime settings

Primary source of truth: `backend/app/core/config.py`.

Key areas:

- Security and auth: JWT keys, credential keys, refresh cookie settings, OIDC/LDAP environment providers.
- Database: `DATABASE_URL` (SQLite defaults to `backend/app.db`; relative SQLite paths are normalized against `backend/`). Multi-backend deployments require PostgreSQL.
- CORS: `CORS_ORIGINS`.
- Feature force-locks: `FEATURE_MANAGER_ENABLED`, `FEATURE_PORTAL_ENABLED`, `FEATURE_BROWSER_ENABLED`, `FEATURE_CEPH_ADMIN_ENABLED`, `FEATURE_STORAGE_OPS_ENABLED`, `FEATURE_BILLING_ENABLED`, `FEATURE_ENDPOINT_STATUS_ENABLED`.
- Internal scheduler auth: `INTERNAL_CRON_TOKEN`.
- Billing, quota monitoring, usage history collection, and healthcheck behavior.
- Backend replica and lease coordination: `BACKEND_REPLICAS`, `OPERATION_LEASE_TTL_SECONDS`, and `BILLING_OPERATION_LEASE_TTL_SECONDS`.
- Shared history retention: `BILLING_DAILY_RETENTION_DAYS`, `QUOTA_HISTORY_HOURLY_RETENTION_DAYS`, `QUOTA_HISTORY_DAILY_RETENTION_DAYS`.
- Quota SMTP secret: `SMTP_PASSWORD`.

OIDC providers can be configured either from Admin **Settings > Authentication**
or with nested environment variables:

- UI-managed OIDC providers are persisted in the `oidc_providers` database
  table. Their `client_secret` value is encrypted with the credential key and
  is write-only: read APIs return only `has_client_secret`.
- Environment-managed providers use `OIDC_PROVIDERS__<key>__...` variables.
  They take priority over any UI provider with the same `provider_id` and appear
  locked/read-only in Admin **Settings > Authentication**.
- `OIDC_STATE_TTL_SECONDS` remains a backend runtime setting and is not editable
  from the UI.

Common environment fields:

- `OIDC_PROVIDERS__<key>__DISPLAY_NAME`
- `OIDC_PROVIDERS__<key>__DISCOVERY_URL`
- `OIDC_PROVIDERS__<key>__CLIENT_ID`
- `OIDC_PROVIDERS__<key>__CLIENT_SECRET`
- `OIDC_PROVIDERS__<key>__REDIRECT_URI`
- `OIDC_PROVIDERS__<key>__SCOPES`
- optional behavior fields: `PROMPT`, `ENABLED`, `ICON_URL`, `USE_PKCE`, `USE_NONCE`

LDAP providers can be configured either from Admin **Settings > Authentication**
or with nested environment variables:

- UI-managed LDAP providers are persisted in the `ldap_providers` database
  table. Their `bind_password` value is encrypted with the credential key and
  is write-only: read APIs return only `has_bind_password`.
- Environment-managed providers use `LDAP_PROVIDERS__<key>__...` variables.
  They take priority over any UI provider with the same `provider_id` and appear
  locked/read-only in Admin **Settings > Authentication**.

Common environment fields:

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
Persistence source: the `app_settings` database table.

`APP_SETTINGS_PATH` is now a legacy import and fallback path. On startup or first
settings read, a deployment with an empty `app_settings` table imports the JSON
file once, then live reads and writes go through the database. Environment
force-locks such as `FEATURE_PORTAL_ENABLED` still override the effective value
without changing the persisted setting.

Managed from Admin UI:

- General feature toggles (`manager_enabled`, `portal_enabled`, `browser_enabled`, `ceph_admin_enabled`, `storage_ops_enabled`, `billing_enabled`, `endpoint_status_enabled`).
- Authentication settings (`allow_login_access_keys`, endpoint selection for access-key login, custom login endpoints, and private S3 connections for UI users).
- Quota supervision toggles (`quota_alerts_enabled`, `usage_history_enabled`).
- Browser sub-flags (`browser_root_enabled`, `browser_manager_enabled`, `browser_portal_enabled`, `browser_ceph_admin_enabled`).
- Portal settings (`portal`): IAM key policy, portal user Storage Space creation, portal user access-key creation, max portal user keys, IAM group policies, bucket access policy, bucket defaults, and super-admin account overrides.
- Migration/compare flags and manager behavior.
- Quota notification policy (`quota_notifications`: threshold, SMTP non-secret fields, contact-email option).

On a fresh deployment with no persisted app settings, `Endpoint Status` and
`Usage history` are enabled by default. `Quota alerts` remains disabled until
explicitly enabled and configured.

The Browser workspace is enabled on root `/browser` and in Portal storage spaces
(`/portal/storage-spaces/:spaceId`) by default. Manager and Ceph Admin Browser
integrations remain disabled until explicitly enabled.

Superadmins manage login behavior and UI-managed OIDC/LDAP providers from Admin
**Settings > Authentication**. The four access-key login options remain in
`AppSettings.general` and are persisted in the database; UI-managed OIDC and
LDAP providers are persisted separately in their own database tables.

`FEATURE_PORTAL_ENABLED` can force the Portal surface on or off. When Portal is enabled, account access remains explicit: admins assign `portal_user` or `portal_manager` on each UI user/account link, while existing links stay `portal_none` until changed.

The default `portal-manager` IAM group policy grants only
`s3:ListAllMyBuckets` and `sts:GetSessionToken`. Storage Space creation, object
access, and bucket defaults stay behind the Portal workflow: bucket creation and
defaults are applied by backend orchestration with account credentials, and
object access is kept in per-user Storage Space policies.

## Frontend runtime settings

- `VITE_API_URL` for API base URL in frontend build/runtime.
- In container deployments, route `/api` to backend via reverse proxy/ingress.

## From user error to configuration area

| User-facing symptom | Check here first |
|---|---|
| Login fails for LDAP/OIDC users | Auth provider variables, TLS settings, and startup warnings. |
| Menu or workspace is missing | App settings feature flags, user role, account links, and entitlements. |
| Browser or Portal files do not open | Browser sub-flags, selected context access, and endpoint capability. |
| `AccessDenied` during an S3 action | IAM/S3 policy and selected execution identity before changing UI flags. |
| Metrics, billing, quota, or history are stale | Scheduler/CronJob settings, `INTERNAL_CRON_TOKEN`, retention, and endpoint capabilities. |
| Quota emails do not arrive | Quota notification policy, SMTP non-secret fields, `SMTP_PASSWORD`, and user opt-in. |

## Branding

Admin can set:

- primary accent color (`#RRGGBB`)
- optional login logo URL

## Related pages

- [Operations: security](operations-security.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)
- [Production readiness](production-readiness.md)
- [Backup and restore](backup-restore.md)
- [Developer: identity and execution model](../developer/identity-and-execution-model.md)

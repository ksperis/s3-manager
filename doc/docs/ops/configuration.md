# Configuration

Configuration is split between backend environment variables and UI settings.

## Configuration checklist

| Priority | Configure | Why |
|---|---|---|
| Required | `DATABASE_URL`, JWT secrets, credential encryption key, `CORS_ORIGINS`, frontend API routing | The app must persist data, protect sessions and stored credentials, and accept requests only from the intended UI origin. |
| Required | `INTERNAL_CRON_TOKEN` when scheduler or CronJobs are enabled | Internal automation endpoints must not be callable without the shared token. |
| Recommended | OIDC or LDAP provider settings | Enterprise identity is safer and easier to operate than local-only users. |
| Recommended | Operational feature flags for billing, endpoint status, usage history, quota alerts, and Manager tools | Optional workflows should be visible only when they are configured and supported. |
| Recommended | Healthcheck, billing, quota, and usage-history schedules and retention | Operational data should be fresh enough to support troubleshooting and capacity decisions. |
| Recommended | SMTP settings when quota alerts are enabled | Quota alerts need a deliverable notification path. |
| Optional | Branding color and login logo | Useful for tenant or lab identity, but not required for safe operation. |

## Backend runtime settings

Primary source of truth: `backend/app/core/config.py`.

Key areas:

- Security and auth: JWT keys, credential keys, refresh cookie settings, OIDC providers, LDAP providers.
- Database: `DATABASE_URL` (SQLite defaults to `backend/app.db`; relative SQLite paths are normalized against `backend/`).
- CORS: `CORS_ORIGINS`.
- Operational feature force-locks: `FEATURE_BILLING_ENABLED`, `FEATURE_ENDPOINT_STATUS_ENABLED`.
- Internal scheduler auth: `INTERNAL_CRON_TOKEN`.
- Billing, quota monitoring, usage history collection, and healthcheck behavior.
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

- General operational feature toggles (`billing_enabled`, `endpoint_status_enabled`).
- Quota supervision toggles (`quota_alerts_enabled`, `usage_history_enabled`).
- Portal settings (`portal`): IAM key policy, portal user Storage Space creation, portal user access-key creation, max portal user keys, IAM group policies, bucket access policy, bucket defaults, and account override policy.
- Migration/compare flags and manager behavior.
- Quota notification policy (`quota_notifications`: threshold, SMTP non-secret fields, contact-email option).

On a fresh deployment with no persisted `app_settings.json`, `Endpoint Status`
and `Usage history` are enabled by default. `Quota alerts` remains disabled
until explicitly enabled and configured.

Workspace visibility is derived from effective access: UI role, account links,
connection access flags, Portal account roles, Ceph Admin or Storage Ops
entitlements, and endpoint capabilities. IAM/S3 remains the authority for the
actual storage action.

The default `portal-manager` IAM group policy grants only
`s3:ListAllMyBuckets` and `s3:CreateBucket`. Storage Space object access is
kept in per-user Storage Space policies, and Portal bucket defaults are applied
by backend orchestration with account credentials.

## Frontend runtime settings

- `VITE_API_URL` for API base URL in frontend build/runtime.
- In container deployments, route `/api` to backend via reverse proxy/ingress.

## From user error to configuration area

| User-facing symptom | Check here first |
|---|---|
| Login fails for LDAP/OIDC users | Auth provider variables, TLS settings, and startup warnings. |
| Menu or workspace is missing | User role, account links, connection access flags, entitlements, and endpoint capability. |
| Browser or Portal files do not open | Selected context access, Portal Storage Space visibility, endpoint capability, and IAM/S3 policy. |
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
- [Developer: identity and execution model](../developer/identity-and-execution-model.md)

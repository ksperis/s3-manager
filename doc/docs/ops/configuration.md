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

## Find the right configuration area

| You need to control... | Primary place | Also check |
|---|---|---|
| Login sessions, stored credentials, trusted origins | Backend environment and secret manager | `APP_ENV`, `PUBLIC_ORIGIN`, `CORS_ORIGINS`, `ALLOWED_HOSTS`, UI/API JWT rings, credential encryption, WebAuthn, trusted proxies, and secure cookies. |
| Which workspaces users can see | Admin app settings and feature force-locks | `FEATURE_*` env locks, user roles, UI groups, account links, Manager tool access. |
| Schedulers and internal automation | Runtime env, Compose scheduler, or Helm CronJobs | `INTERNAL_CRON_TOKEN`, `healthcheckCronJob`, `billingCronJob`, `quotaMonitorCronJob`, `usageHistoryCronJob`. |
| Health, metrics, billing, quota, and usage history freshness | App settings plus job schedules | Endpoint capability, retention env vars, latest collection logs. |
| Enterprise authentication | Admin **Settings > Authentication** or env-managed OIDC/LDAP providers | TLS verification, provider priority, write-only secrets, startup warnings. |
| Portal self-service behavior | Admin Portal settings | Portal account links, Storage Space defaults, access-key policy, IAM group projections. |
| Browser exposure | Browser app settings and sub-flags | Root Browser, Manager Browser, Portal Browser, Ceph Admin Browser, endpoint capability. |
| Notifications | Quota notification app settings plus runtime SMTP secret | `SMTP_PASSWORD`, user opt-in, global watch policy, test email action. |

## Minimum day-one settings

Before onboarding real users, an operator should be able to name:

- where the application database lives and how it is backed up
- where the credential encryption key and scheduler token are stored
- which trusted UI origins are allowed
- which workspaces are enabled by feature flags and app settings
- which scheduler jobs or CronJobs are enabled or intentionally disabled
- which endpoint is the first production-like storage backend
- which support page users should open when reporting failures

## Backend runtime settings

Primary source of truth: `backend/app/core/config.py`.

Key areas:

- Security and auth: `APP_ENV`, distinct `UI_JWT_KEYS`/`API_JWT_KEYS`,
  `CREDENTIAL_KEYS`, access/session lifetimes, secure host-only cookie settings,
  `PUBLIC_ORIGIN`, `ALLOWED_HOSTS`, `TRUSTED_PROXY_CIDRS`, WebAuthn, and
  OIDC/LDAP environment providers.
- Database: `DATABASE_URL` (SQLite defaults to `backend/app.db`; relative SQLite paths are normalized against `backend/`). Multi-backend deployments require PostgreSQL.
- CORS: `CORS_ORIGINS`.
- Feature force-locks: `FEATURE_MANAGER_ENABLED`, `FEATURE_PORTAL_ENABLED`, `FEATURE_BROWSER_ENABLED`, `FEATURE_CEPH_ADMIN_ENABLED`, `FEATURE_STORAGE_OPS_ENABLED`, `FEATURE_BILLING_ENABLED`, `FEATURE_ENDPOINT_STATUS_ENABLED`.
- Internal scheduler auth: `INTERNAL_CRON_TOKEN`.
- Billing, quota monitoring, usage history collection, and healthcheck behavior.
- Backend replica and lease coordination: `BACKEND_REPLICAS`, `OPERATION_LEASE_TTL_SECONDS`, and `BILLING_OPERATION_LEASE_TTL_SECONDS`.
- Shared history retention: `BILLING_DAILY_RETENTION_DAYS`, `QUOTA_HISTORY_HOURLY_RETENTION_DAYS`, `QUOTA_HISTORY_DAILY_RETENTION_DAYS`.
- Quota SMTP secret: `SMTP_PASSWORD`.
- Interactive storage budgets: `STORAGE_INTERACTIVE_CONNECT_TIMEOUT_SECONDS` (default `2`),
  `STORAGE_INTERACTIVE_READ_TIMEOUT_SECONDS` (default `5`), and
  `STORAGE_INTERACTIVE_MAX_ATTEMPTS` (default `2`). These bound UI-facing S3,
  IAM, SNS, and STS calls. Long-running S3 streams, bulk inventories, and file
  transfers keep the same connect/retry budget but use
  `STORAGE_LONG_RUNNING_READ_TIMEOUT_SECONDS` (default `60`) for socket reads.
- RGW Admin availability probes use `RGW_ADMIN_PROBE_TIMEOUT_SECONDS` (default
  `3`) while ordinary Admin Ops and bucket-statistics calls keep their separate
  `RGW_ADMIN_TIMEOUT_SECONDS` and `RGW_ADMIN_BUCKET_LIST_STATS_TIMEOUT_SECONDS`
  budgets.

## First-administrator bootstrap

There are no administrator identity or password environment variables. The
bootstrap is explicitly enabled only by issuing a token after migrations:

```bash
cd backend
python -m app.scripts.issue_first_admin_bootstrap
```

The token is 256 bits, valid for 15 minutes and single-use. Only its SHA-256
digest, issuance/expiration timestamps and consumption state are persisted. The
printed URL uses `PUBLIC_ORIGIN` and places the token after `#`, so reverse
proxies and HTTP access logs do not receive it. The browser removes the fragment
immediately and does not write it to browser storage.

`POST /api/auth/bootstrap/first-admin` accepts the token only in
`X-BucketReef-Bootstrap-Token`, requires the exact trusted `Origin`, applies the
authentication rate limit by client IP and returns a generic unavailable error
for absent, expired, invalid or consumed tokens. Issuing another token revokes
the previous one while the database has no users.

Use `python -m app.scripts.create_first_admin` when a direct console workflow is
required. Use `reset_last_superadmin_mfa` only to recover the sole existing
super-administrator. Recovery never reactivates initial bootstrap.

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
- optional behavior fields: `PROMPT`, `ENABLED`, `ICON_URL`, `USE_PKCE`,
  `USE_NONCE`, `ALLOWED_ALGORITHMS`, `ALLOWED_HOSTS`, `LINKING_POLICY`, and
  `TRUSTED_EMAIL_DOMAINS`. `trusted_email` is OIDC-only and requires exact,
  normalized domains plus the verified-email eligibility rules.

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
- optional service credentials: `LDAP_PROVIDERS__<key>__BIND_DN` /
  `LDAP_PROVIDERS__<key>__BIND_PASSWORD`; configure both together or omit both
  to search anonymously when directory ACLs permit it
- `LDAP_PROVIDERS__<key>__USER_BASE_DN`
- `LDAP_PROVIDERS__<key>__USER_FILTER` containing `{username}`
- optional attributes: `EMAIL_ATTRIBUTE`, `NAME_ATTRIBUTE`, `SUBJECT_ATTRIBUTE`
- TLS and safety knobs: `START_TLS`, `TLS_VERIFY`, `TLS_CA_FILE`,
  `ALLOW_LEGACY_TLS`, `ALLOW_INSECURE`.
  `ALLOW_LEGACY_TLS=true` enables the OpenSSL `DEFAULT` cipher set for a
  provider that cannot negotiate the modern client defaults; prefer enabling
  ECDHE cipher suites on the LDAP server.

Provider keys must match `[a-z0-9_-]+`. `ALLOW_INSECURE=true`,
`TLS_VERIFY=false`, and `ALLOW_LEGACY_TLS=true` are rejected when
`APP_ENV=production`. LDAP email collisions are never linked automatically.

LDAP only authenticates the UI identity. First LDAP login creates a user with
`ui_none`; admins still grant roles and storage access in BucketReef.

## App settings (persisted)

Primary model: `backend/app/models/app_settings.py`.
Persistence source: the `app_settings` database table.

`APP_SETTINGS_PATH` is an optional bootstrap import path. On startup or first
settings read, a deployment with an empty `app_settings` table imports the JSON
file once, then live reads and writes go through the database. Runtime database
errors are not hidden by a file fallback. Environment force-locks such as
`FEATURE_PORTAL_ENABLED` still override the effective value without changing the
persisted setting.

Managed from Admin UI:

- General feature toggles (`manager_enabled`, `portal_enabled`, `browser_enabled`, `ceph_admin_enabled`, `storage_ops_enabled`, `billing_enabled`, `endpoint_status_enabled`).
- Authentication settings (`allow_login_access_keys`, endpoint selection for access-key login, custom login endpoints, `require_passkey_for_admins`, `require_passkey_for_users`, `allow_user_profile_name_edit`, and `allow_user_external_identity_unlink`). The defaults require passkeys only for Admins and keep both self-service permissions disabled.
- Quota supervision toggles (`quota_alerts_enabled`, `usage_history_enabled`).
- Browser sub-flags (`browser_root_enabled`, `browser_manager_enabled`, `browser_portal_enabled`, `browser_ceph_admin_enabled`).
- Portal settings (`portal`): standalone Browser access (`browser_access_enabled`, disabled by default), IAM key availability, private Storage Space creation, portal user access-key creation, server access log retention for newly created technical log buckets, max portal user keys, and bucket defaults. Portal settings can be overridden per account by a super-admin. The per-account `portal_settings_delegated` flag is disabled by default; when enabled, project Portal Managers can edit the same shared override from `/portal/settings`. Disabling delegation keeps the stored override effective but read-only in Portal. `bucket_defaults.noncurrent_version_expiration_days` is the internal key for **Version history retention**; it is a positive integer (90 by default) and applies only when provisioning a new Storage Space with the default lifecycle enabled. Existing buckets are not reconciled automatically.
- Manager tool flags and behavior: bucket migration, compare, integrity check,
  purge, usage stats, Ceph S3 User key management, and migration parallelism.
- Quota notification policy (`quota_notifications`: threshold, SMTP non-secret fields, contact-email option).

On a fresh deployment with no persisted app settings, `Endpoint Status` and
`Usage history` are enabled by default. `Quota alerts` remains disabled until
explicitly enabled and configured.

The Browser surface is enabled on root `/browser` and inside Portal storage
spaces (`/portal/storage-spaces/:spaceId`) by default. Portal projects do not
appear in the root Browser until `portal.browser_access_enabled` is enabled
globally or by account override. Manager and Ceph Admin Browser integrations
remain disabled until explicitly enabled.

The Settings tab of an existing Storage Space is separate from project
defaults. Owners and Portal Managers can read the bucket's Versioning,
Lifecycle, and version history retention values. Only a project Portal Manager
can update an active space. These calls use the manager's personal IAM identity
and manage only the Portal lifecycle rules `ExpireDeleteMarkers` and
`ExpireOldVersions`; unrelated lifecycle rules are preserved.

Superadmins manage login behavior and UI-managed OIDC/LDAP providers from Admin
**Settings > Authentication**. The four access-key login options remain in
`AppSettings.general` and are persisted in the database; UI-managed OIDC and
LDAP providers are persisted separately in their own database tables.

`FEATURE_PORTAL_ENABLED` can force the Portal surface on or off. Account access
uses two independent axes: `manager_role` is `account_administrator` or `null`,
and `portal_role` is `portal_user`, `portal_manager`, or `null`. At least one
axis is required. Disabling Portal prevents new Portal selections but does not
rewrite or remove existing Portal roles; new links default to Manager
administrator while the feature is off and to Portal user while it is on.

The code-owned `portal-user` IAM group policy grants only
`s3:ListAllMyBuckets` and `sts:GetSessionToken`. The code-owned
`portal-manager` group adds the explicit Storage Space data-plane actions on
all buckets in the single RGW Account backing the project. Technical Portal
buckets add an explicit resource-policy denial for manager IAM principals.
Storage Space creation and bucket defaults remain backend workflows. Private
Owner and team Viewer/Editor projections are generated from database state;
Portal IAM policies are not editable settings.

## Frontend runtime settings

- `VITE_API_URL` for API base URL in frontend build/runtime.
- In container deployments, route `/api` to backend via reverse proxy/ingress.
- Browser identity always comes from `/api/auth/session`; UI tokens must never
  be added to `VITE_*` values or browser storage.

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

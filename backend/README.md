# s3-manager Backend (FastAPI)

## Quickstart

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend uses SQLite by default (`app.db`) and auto-seeds a super-admin:
- email: `admin@example.com`
- password: `changeme`

Important: defaults are for local development only. Replace all default secrets/passwords before exposing the service.
SQLite is supported for local development and mono-backend deployments only. Use
PostgreSQL for multiple backend replicas.

## Migrations (Alembic)

Schema migrations are managed by Alembic and are applied automatically at startup.

Common commands (from `backend/`):

```bash
alembic upgrade head
alembic revision --autogenerate -m "describe change"
```

## Installer Python 3.12 avec pyenv (si absent des dépôts)

```bash
curl https://pyenv.run | bash
# ajouter pyenv à votre shell (~/.bashrc ou ~/.zshrc) puis recharger
pyenv install 3.12.8
pyenv local 3.12.8  # dans ce repo, ou pyenv global 3.12.8
python -m venv .venv
```

## Demo data seeding

To quickly populate a dev RGW/S3 environment with realistic demo accounts, buckets, users, and objects:

```bash
cd backend
python -m app.scripts.seed_demo_data \
  --config app/scripts/demo_seed.yaml \
  --accounts 30 \
  --min-buckets 10 --max-buckets 20 \
  --min-objects 5 --max-objects 15
```

- Uses the RGW admin credentials defined in your `.env` / environment to create tenants and buckets.
- `app/scripts/demo_seed.yaml` provides a curated starting point; omit `--config` to generate everything randomly. Names are automatically hyphenated to satisfy RGW account constraints.
- For every account the seeder creates an IAM service user, attaches `AmazonS3FullAccess`, and uses that user's keys to create/populate buckets (mirrors UI behaviour).
- Flags like `--password`, `--users-per-account`, `--quota-gb`, and `--seed` can tailor the output for your scenario.
- Account quota management (create/update) requires Ceph RGW 20.3.0 or newer.

## Configuration

Environment variables (or `.env` file) supported via `pydantic`:

- `APP_NAME` (default: `s3-manager`)
- `API_V1_PREFIX` (default: `/api`)
- `JWT_KEYS` (JSON list or comma-separated keyring; first key signs new JWTs)
- `CREDENTIAL_KEYS` (JSON list or comma-separated keyring; first key encrypts new secrets)
- `ACCESS_TOKEN_EXPIRE_MINUTES` (default: `60`)
- `REFRESH_TOKEN_EXPIRE_MINUTES` (default: `20160`)
- `LOG_LEVEL` (default: `INFO`)
- `LOGIN_RATE_LIMIT_WINDOW_SECONDS` (default: `300`)
- `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` (default: `10`)
- `API_TOKEN_DEFAULT_EXPIRE_DAYS` (default: `90`)
- `API_TOKEN_MAX_EXPIRE_DAYS` (default: `365`)
- `REFRESH_TOKEN_COOKIE_NAME` (default: `refresh_token`)
- `REFRESH_TOKEN_COOKIE_PATH` (default: `/api/auth`)
- `REFRESH_TOKEN_COOKIE_DOMAIN` (default: unset)
- `REFRESH_TOKEN_COOKIE_SECURE` (default: `false`)
- `REFRESH_TOKEN_COOKIE_SAMESITE` (default: `lax`)
- `DATABASE_URL` (default: SQLite file at `backend/app.db`; relative SQLite paths are normalized against `backend/`; use PostgreSQL for multi-backend)
- `APP_SETTINGS_PATH` (optional JSON bootstrap import when the `app_settings` DB row is missing; live app settings are stored in the database)
- `BACKEND_REPLICAS` (default: `1`, used to warn about unsupported SQLite multi-backend deployments)
- `OPERATION_LEASE_TTL_SECONDS` (default: `1800`, DB lease TTL for healthcheck/quota/history jobs)
- `BILLING_OPERATION_LEASE_TTL_SECONDS` (default: `7200`, DB lease TTL for daily billing collection)
- `SEED_S3_ENDPOINT` (default: `http://localhost:9000`)
- `SEED_S3_ENDPOINT_FEATURES` (YAML or JSON, used to seed default endpoint features)
- `ENV_STORAGE_ENDPOINTS` (JSON array, authoritative list of storage endpoints managed by env)
- `SEED_S3_ACCESS_KEY` / `SEED_S3_SECRET_KEY`
- `SEED_S3_REGION` (default: `us-east-1`)
- `SEED_RGW_ADMIN_ACCESS_KEY` / `SEED_RGW_ADMIN_SECRET_KEY` (optional override for the default endpoint admin credentials)
- `SEED_SUPERVISION_ACCESS_KEY` / `SEED_SUPERVISION_SECRET_KEY` (optional read-only credentials for usage/metrics)
- `CORS_ORIGINS` (default: `["http://localhost:5173"]`)
- `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` / `SEED_SUPER_ADMIN_FULL_NAME`
- `SEED_SUPER_ADMIN_MODE` (default: `if_empty`, values: `if_empty|if_missing|disabled`)
- `OIDC_STATE_TTL_SECONDS` (default: `600`, validity of login `state`)
- `OIDC_PROVIDERS__<key>__*` to configure OpenID Connect providers (see below)
- `LDAP_PROVIDERS__<key>__*` to configure LDAP providers (see below)

JWT signing uses the first key in `JWT_KEYS` and validates against the full list.

Security notes:
- Production environments should set strong non-default values for `JWT_KEYS` and `CREDENTIAL_KEYS` (>=32 chars, high entropy).
- Production environments should set `REFRESH_TOKEN_COOKIE_SECURE=true` when using non-local origins, and `CORS_ORIGINS` should list explicit trusted origins rather than `*`.
- Keep `SEED_SUPER_ADMIN_PASSWORD` as a bootstrap credential only and rotate it immediately.
- Prefer `SEED_SUPER_ADMIN_MODE=if_empty` (default) or `disabled` in production to avoid accidental super-admin reseeding on restart.
- HTTP 5xx responses redact URLs, authorization headers, tokens, signatures, and access-key material before details are returned to clients or written through the HTTP exception logger.

### Credential key rotation (manual)

To rotate the credential encryption key, run:

```bash
python -m app.scripts.rotate_credential_keys --new-key "your-new-key"
```

Then update `CREDENTIAL_KEYS` with the new value first and retain any previous
key until every backend replica and stored credential has been rotated.

To seed a default endpoint with features enabled, provide `SEED_S3_ENDPOINT` along with a JSON/YAML payload:

```bash
export SEED_S3_ENDPOINT_FEATURES='{"features":{"admin":{"enabled":true},"sts":{"enabled":true},"usage":{"enabled":true},"metrics":{"enabled":false},"static_website":{"enabled":true}}}'
```

### OpenID Connect / Google Login

The API can delegate authentication to one or more OIDC providers (Google, Azure AD, Keycloak, ...).

Providers can be managed from Admin **Settings > Authentication** or defined
with environment variables. UI-managed providers are persisted in the
`oidc_providers` database table and their `client_secret` is encrypted with the
credential key. Read APIs never return the secret; they expose only
`has_client_secret`.

Environment-managed providers are still supported through `Settings.oidc_providers`.
They take priority over UI providers with the same key and are shown as locked
read-only entries in Admin **Settings > Authentication**. With
`pydantic-settings`, nested fields can be set through environment variables such
as:

```bash
export OIDC_PROVIDERS__google__display_name="Google"
export OIDC_PROVIDERS__google__discovery_url="https://accounts.google.com/.well-known/openid-configuration"
export OIDC_PROVIDERS__google__client_id="xxxxxxxxxx.apps.googleusercontent.com"
export OIDC_PROVIDERS__google__client_secret="your-client-secret"
export OIDC_PROVIDERS__google__redirect_uri="http://localhost:5173/oidc/google/callback"
export OIDC_PROVIDERS__google__scopes='["openid","email","profile"]'
```

- `redirect_uri` must match the URL registered in the Google console; the default frontend route `/oidc/<provider>/callback` is ready for localhost setups.
- If no providers are configured the login page silently hides the SSO block.
- When a user signs in with OIDC for the first time they are automatically created in the database without any account assignments. An administrator must later grant access to specific accounts/users.
- Additional providers can be defined by repeating the prefix (`OIDC_PROVIDERS__azure__...` etc.). Future providers reuse the same `/api/auth/oidc/<provider>/start|callback` pipeline.
- `OIDC_STATE_TTL_SECONDS` remains a backend runtime setting and is not managed from the Admin UI.

### LDAP Login

The API can authenticate UI users against one or more LDAP directories. LDAP is an
identity check only: s3-manager remains the source of truth for UI roles, S3
account membership, S3 user links, and shared S3 connections.

Providers can be managed from Admin **Settings > Authentication** or defined
with environment variables. UI-managed providers are persisted in the
`ldap_providers` database table and their `bind_password` is encrypted with the
credential key. Read APIs never return the password; they expose only
`has_bind_password`.

Environment-managed providers are still supported through `Settings.ldap_providers`.
They take priority over UI providers with the same key and are shown as locked
read-only entries in Admin **Settings > Authentication**.

```bash
export LDAP_PROVIDERS__corp__display_name="Corporate LDAP"
export LDAP_PROVIDERS__corp__url="ldaps://ldap.example.com:636"
export LDAP_PROVIDERS__corp__bind_dn="cn=s3-manager,ou=services,dc=example,dc=com"
export LDAP_PROVIDERS__corp__bind_password="service-account-secret"
export LDAP_PROVIDERS__corp__user_base_dn="ou=people,dc=example,dc=com"
export LDAP_PROVIDERS__corp__user_filter='(|(mail={username})(uid={username})(sAMAccountName={username})(userPrincipalName={username}))'
export LDAP_PROVIDERS__corp__email_attribute="mail"
export LDAP_PROVIDERS__corp__name_attribute="displayName"
export LDAP_PROVIDERS__corp__subject_attribute="entryUUID"
```

- Provider keys must use lowercase letters, digits, `_`, or `-` only, for example `corp` or `openldap-prod`.
- `bind_dn` and `bind_password` are optional, but must be configured together. When both are omitted, s3-manager searches the directory anonymously before binding as the matched user; the directory ACLs must allow anonymous access to the configured user attributes.
- Use `ldaps://` or `ldap://` with `start_tls=true`. Plain LDAP without STARTTLS is rejected unless `allow_insecure=true`, which should be limited to isolated labs.
- Set `allow_legacy_tls=true` only for LDAP servers that require TLS cipher suites excluded by the modern Python/OpenSSL defaults. This enables the OpenSSL `DEFAULT` cipher set for that provider; enabling modern ECDHE suites on the server remains preferable.
- `tls_verify=false` and `allow_email_linking=true` are allowed for compatibility and planned migrations, but they emit startup security warnings.
- First LDAP sign-in creates an active external UI user with role `ui_none` and no storage access. An administrator must grant the intended role and bindings.
- If LDAP returns an email already used by a local account, login is refused by default. Set `allow_email_linking=true` only for a planned migration where that takeover is intended.
- The login page hides the Directory tab when no LDAP providers are enabled. Additional environment providers can be defined by repeating the prefix (`LDAP_PROVIDERS__ad__...`, `LDAP_PROVIDERS__openldap__...`).

## Included endpoints (MVP)

- Common: `GET /health`, `POST /api/auth/login`, `GET /api/users/me`
- Admin API tokens: `GET/POST /api/auth/api-tokens`, `DELETE /api/auth/api-tokens/{token_id}`
- Admin space (`super_admin`): `GET/POST /api/admin/accounts`, `GET /api/admin/stats/overview`
- Admin users (`super_admin`): `GET/POST /api/admin/users`, `PUT /api/admin/users/{id}`, `DELETE /api/admin/users/{id}`
- Manager space (`account_admin` or `super_admin`): `GET/POST/DELETE /api/manager/buckets`, `GET /api/manager/iam/policies`, `GET /api/manager/stats/buckets`

Default seeded admin for quickstart:
- email: `admin@example.com`
- password: `changeme`

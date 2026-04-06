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
- `FERNET_KEY` (default: `change-me`, JWT signing key)
- `JWT_KEYS` (optional JSON list or comma-separated; overrides `FERNET_KEY`)
- `CREDENTIAL_KEY` (default: `change-me`, encrypts secrets at rest)
- `CREDENTIAL_KEYS` (optional JSON list or comma-separated; overrides `CREDENTIAL_KEY`)
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
- `DATABASE_URL` (default: SQLite file at `backend/app.db`; relative SQLite paths are normalized against `backend/`)
- `APP_SETTINGS_PATH` (default: `backend/app/data/app_settings.json`, set to a persistent path to keep UI settings; use shared storage for multi-backend)
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

JWT signing uses the first key in `JWT_KEYS` and validates against the full list.

Security notes:
- Production environments should set strong non-default values for `FERNET_KEY`/`JWT_KEYS` and `CREDENTIAL_KEY`/`CREDENTIAL_KEYS` (>=32 chars, high entropy).
- Production environments should set `REFRESH_TOKEN_COOKIE_SECURE=true` when using non-local origins.
- Keep `SEED_SUPER_ADMIN_PASSWORD` as a bootstrap credential only and rotate it immediately.
- Prefer `SEED_SUPER_ADMIN_MODE=if_empty` (default) or `disabled` in production to avoid accidental super-admin reseeding on restart.

### Credential key rotation (manual)

To rotate the credential encryption key, run:

```bash
python -m app.scripts.rotate_credential_keys --new-key "your-new-key"
```

Then update `CREDENTIAL_KEY` / `CREDENTIAL_KEYS` to the new value.

To seed a default endpoint with features enabled, provide `SEED_S3_ENDPOINT` along with a JSON/YAML payload:

```bash
export SEED_S3_ENDPOINT_FEATURES='{"features":{"admin":{"enabled":true},"sts":{"enabled":true},"usage":{"enabled":true},"metrics":{"enabled":false},"static_website":{"enabled":true}}}'
```

### OpenID Connect / Google Login

The API can delegate authentication to one or more OIDC providers (Google, Azure AD, Keycloak, ...). Each provider is defined in `Settings.oidc_providers`. With `pydantic-settings`, nested fields can be set through environment variables such as:

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

## Included endpoints (MVP)

- Common: `GET /health`, `POST /api/auth/login`, `GET /api/users/me`
- Admin API tokens: `GET/POST /api/auth/api-tokens`, `DELETE /api/auth/api-tokens/{token_id}`
- Admin space (`super_admin`): `GET/POST /api/admin/accounts`, `GET /api/admin/stats/overview`
- Admin users (`super_admin`): `GET/POST /api/admin/users`, `PUT /api/admin/users/{id}`, `DELETE /api/admin/users/{id}`
- Manager space (`account_admin` or `super_admin`): `GET/POST/DELETE /api/manager/buckets`, `GET /api/manager/iam/policies`, `GET /api/manager/stats/buckets`

Default seeded admin for quickstart:
- email: `admin@example.com`
- password: `changeme`

## RGW capability maintenance

S3Account-level admin users rely on RGW capabilities (info/usage/buckets/metadata read) to call the Ceph admin API with their own access keys. 
If you already have tenants in RGW, run the helper script once after deploying the updated backend to grant those caps:

```bash
python -m app.scripts.grant_account_caps
```

The script uses the credentials defined by `SEED_RGW_ADMIN_ACCESS_KEY` / `SEED_RGW_ADMIN_SECRET_KEY` to update each `<tenant>-admin` user.

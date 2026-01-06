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

## Configuration

Environment variables (or `.env` file) supported via `pydantic`:

- `APP_NAME` (default: `s3-manager`)
- `API_V1_PREFIX` (default: `/api`)
- `SECRET_KEY` (default: `change-me`)
- `ACCESS_TOKEN_EXPIRE_MINUTES` (default: `60`)
- `DATABASE_URL` (default: `sqlite:///./app.db`)
- `S3_ENDPOINT` (default: `http://localhost:9000`)
- `S3_ENDPOINT_FEATURES` (YAML or JSON, used to seed default endpoint features)
- `S3_ACCESS_KEY` / `S3_SECRET_KEY`
- `S3_REGION` (default: `us-east-1`)
- `RGW_ADMIN_ACCESS_KEY` / `RGW_ADMIN_SECRET_KEY` (optional override for the default endpoint admin credentials)
- `SUPERVISION_ACCESS_KEY` / `SUPERVISION_SECRET_KEY` (optional read-only credentials for usage/metrics)
- `CORS_ORIGINS` (default: `["http://localhost:5173"]`)
- `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` / `SUPER_ADMIN_FULL_NAME`
- `OIDC_STATE_TTL_SECONDS` (default: `600`, validity of login `state`)
- `OIDC_PROVIDERS__<key>__*` to configure OpenID Connect providers (see below)

To seed a default endpoint with features enabled, provide `S3_ENDPOINT` along with a JSON/YAML payload:

```bash
export S3_ENDPOINT_FEATURES='{"features":{"admin":{"enabled":true},"sts":{"enabled":true},"usage":{"enabled":true},"metrics":{"enabled":false},"static_website":{"enabled":true}}}'
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

The script uses the credentials defined by `RGW_ADMIN_ACCESS_KEY` / `RGW_ADMIN_SECRET_KEY` to update each `<tenant>-admin` user.

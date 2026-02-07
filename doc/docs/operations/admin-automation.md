# Admin Automation API

This API provides a single, idempotent endpoint to manage Admin resources in bulk or one-by-one. It is designed to be automation-friendly, especially for Ansible, with explicit `changed` reporting and a `dry_run` mode.

## Endpoint

`POST /api/admin/automation/apply`

Single-item endpoints (one resource per call):
- `POST /api/admin/automation/storage-endpoints/apply`
- `POST /api/admin/automation/ui-users/apply`
- `POST /api/admin/automation/s3-accounts/apply`
- `POST /api/admin/automation/s3-users/apply`
- `POST /api/admin/automation/s3-connections/apply`
- `POST /api/admin/automation/account-links/apply`

## Authentication

Requires an Admin session (same as other `/admin/*` endpoints).
For non-interactive automation (Ansible, CI), you can create a long-lived admin API token:

- `POST /api/auth/api-tokens` with an existing admin bearer token
- Use the returned `access_token` as `Authorization: Bearer ...`
- Revoke with `DELETE /api/auth/api-tokens/{token_id}` when no longer needed

See [Admin API tokens](api-tokens.md) for complete cURL and Ansible token-management examples.

## Request Structure

Top-level fields:
- `dry_run`: simulate changes without applying them.
- `continue_on_error`: continue processing after a failure.
- `storage_endpoints`: list of endpoint operations.
- `ui_users`: list of UI user operations.
- `s3_accounts`: list of S3 account operations.
- `s3_users`: list of S3 user operations.
- `account_links`: list of user↔account link operations.

Every list item follows a common pattern:
- `state`: `present` or `absent`.
- `match`: identifies the existing resource.
- `spec`: desired state (required for creation).

Single-item endpoints accept this payload shape:
```json
{
  "dry_run": false,
  "continue_on_error": false,
  "item": { "state": "present", "match": { "...": "..." }, "spec": { "...": "..." } }
}
```

## Response Structure

The response includes summary counts and per-item results:
- `changed`: global changed flag.
- `success`: `true` when no failures occurred.
- `summary`: counts per action.
- `results`: per-item status, `changed`, and optional `diff`.

## Idempotency and `changed`

The service compares the desired spec to the current state and returns `changed=false` when there is nothing to do. Use `dry_run=true` to compute `changed` without applying modifications.

## Error Handling

If `continue_on_error=false` and an item fails, the API responds with `400` and includes the same response body so automation can surface the failure details.

## Examples

### Curl (single payload, mixed resources)
```bash
curl -X POST https://example/api/admin/automation/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": false,
    "continue_on_error": false,
    "storage_endpoints": [
      {
        "state": "present",
        "match": { "endpoint_url": "https://s3.example.com" },
        "spec": {
          "name": "prod-s3",
          "provider": "ceph",
          "features_config": "features:\n  admin:\n    enabled: true\n"
        },
        "update_secrets": true
      }
    ],
    "ui_users": [
      {
        "state": "present",
        "match": { "email": "alice@example.com" },
        "spec": { "full_name": "Alice", "role": "ui_user", "password": "secret" }
      }
    ],
    "s3_accounts": [
      {
        "state": "present",
        "match": { "name": "tenant-a" },
        "spec": { "email": "billing@example.com", "storage_endpoint_name": "prod-s3" }
      }
    ],
    "s3_users": [
      {
        "state": "present",
        "match": { "uid": "svc-app" },
        "spec": { "name": "svc-app", "storage_endpoint_name": "prod-s3" }
      }
    ],
    "account_links": [
      {
        "state": "present",
        "user": { "email": "alice@example.com" },
        "account": { "name": "tenant-a" },
        "account_role": "portal_manager",
        "account_admin": true
      }
    ]
  }'
```

### Ansible (URI module)
```yaml
- name: Apply admin automation
  ansible.builtin.uri:
    url: "https://example/api/admin/automation/apply"
    method: POST
    headers:
      Authorization: "Bearer {{ token }}"
      Content-Type: "application/json"
    body_format: json
    body:
      dry_run: false
      continue_on_error: false
      storage_endpoints:
        - state: present
          match:
            endpoint_url: "https://s3.example.com"
          spec:
            name: "prod-s3"
            provider: "ceph"
            features_config: |
              features:
                admin:
                  enabled: true
          update_secrets: true
      ui_users:
        - state: present
          match:
            email: "alice@example.com"
          spec:
            full_name: "Alice"
            role: "ui_user"
            password: "secret"
  register: admin_apply

- name: Report changed status
  ansible.builtin.debug:
    msg: "Changed = {{ admin_apply.json.changed }}"
```

### Register an existing account (DB-only)
```json
{
  "dry_run": false,
  "continue_on_error": false,
  "s3_accounts": [
    {
      "state": "present",
      "action": "register",
      "match": { "rgw_account_id": "RGW000123" },
      "spec": {
        "name": "tenant-a",
        "rgw_account_id": "RGW000123",
        "root_user_uid": "RGW000123-admin",
        "rgw_access_key": "AKIA...",
        "rgw_secret_key": "SECRET",
        "storage_endpoint_name": "prod-s3"
      }
    }
  ]
}
```

## Resource Details

### Storage Endpoints

Matching fields:
- `id`
- `name`
- `endpoint_url`

Spec fields:
- `name`
- `endpoint_url`
- `region`
- `provider`
- `features_config`
- `admin_access_key`, `admin_secret_key`
- `supervision_access_key`, `supervision_secret_key`
- `set_default`

Notes:
- Secrets only update when `update_secrets=true`.
- `set_default=true` flips the default endpoint.

### UI Users

Matching fields:
- `id`
- `email`

Spec fields:
- `email`
- `password`
- `full_name`
- `role`
- `is_active`
- `is_root`
- `s3_user_ids`
- `s3_connection_ids`

Notes:
- Password updates only when `set_password=true`.

### S3 Accounts

Matching fields:
- `id`
- `name`
- `rgw_account_id`

Spec fields:
- `name`
- `email`
- `rgw_account_id`
- `root_user_uid`
- `rgw_access_key`
- `rgw_secret_key`
- `quota_max_size_gb`, `quota_max_size_unit`
- `quota_max_objects`
- `storage_endpoint_id`, `storage_endpoint_name`, `storage_endpoint_url`

Notes:
- `action` can be `create` (default, RGW admin required) or `register` (DB-only).
- `register` requires `rgw_account_id`, `root_user_uid`, `rgw_access_key`, `rgw_secret_key`, and a valid `storage_endpoint_*`.
- Deletion is **DB-only** in this automation endpoint.
- Quota operations call RGW when enabled on the endpoint.

### S3 Users

Matching fields:
- `id`
- `uid` (RGW UID)

Spec fields:
- `name`
- `uid`
- `email`
- `rgw_access_key`
- `rgw_secret_key`
- `quota_max_size_gb`, `quota_max_size_unit`
- `quota_max_objects`
- `storage_endpoint_id`, `storage_endpoint_name`, `storage_endpoint_url`
- `user_ids`

Notes:
- `action` can be `create` (default, RGW admin required) or `register` (DB-only).
- `register` requires `uid`, `name`, `rgw_access_key`, `rgw_secret_key`, and a valid `storage_endpoint_*`.
- Storage endpoint cannot be changed once set.
- Deletion is **DB-only** in this automation endpoint.

### S3 Connections

Matching fields:
- `id`
- `name`

Spec fields:
- `name`
- `storage_endpoint_id`
- `endpoint_url`
- `region`
- `provider_hint`
- `force_path_style`
- `verify_tls`
- `is_public`
- `access_key_id`
- `secret_access_key`

Notes:
- Credentials are updated only when `update_credentials=true`.

### Account Links (UI user ↔ S3 account)

Matching fields:
- `user`: `id` or `email`
- `account`: `id`, `name`, or `rgw_account_id`

Spec fields:
- `account_role`
- `account_admin`

Notes:
- Root account links are protected and cannot be removed or modified.

# Admin API Tokens

Admin API tokens are long-lived JWT bearer tokens intended for non-interactive automation (Ansible, CI jobs, scripts).

They are managed with:

- `GET /api/auth/api-tokens`
- `POST /api/auth/api-tokens`
- `DELETE /api/auth/api-tokens/{token_id}`

## Behavior

- Only `ui_admin` users can create/revoke tokens.
- A token value is returned only once at creation time.
- Revocation is immediate.
- Expiry is enforced server-side.
- No refresh-cookie flow is required to use an API token.

## Configuration

Token lifetime is controlled by backend settings:

- `API_TOKEN_DEFAULT_EXPIRE_DAYS` (default: `90`)
- `API_TOKEN_MAX_EXPIRE_DAYS` (default: `365`)

## cURL examples

### 1) Log in as admin (bootstrap)

```bash
ACCESS_TOKEN="$(
  curl -sS -X POST "https://example/api/auth/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "username=admin@example.com" \
    --data-urlencode "password=change-me" \
  | jq -r '.access_token'
)"
```

### 2) Create a long-lived API token

```bash
curl -sS -X POST "https://example/api/auth/api-tokens" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"ansible-prod","expires_in_days":180}'
```

### 3) Use the token

```bash
curl -sS -X GET "https://example/api/admin/users/minimal" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

### 4) Revoke a token

```bash
curl -sS -X DELETE "https://example/api/auth/api-tokens/${TOKEN_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

## Ansible examples

### Bootstrap + create API token

```yaml
- name: Log in as admin (bootstrap session token)
  ansible.builtin.uri:
    url: "{{ s3_manager_url }}/api/auth/login"
    method: POST
    headers:
      Content-Type: "application/x-www-form-urlencoded"
    body_format: form-urlencoded
    body:
      username: "{{ s3_manager_admin_user }}"
      password: "{{ s3_manager_admin_password }}"
      grant_type: password
    return_content: true
  register: s3m_login
  no_log: true

- name: Create API token for automation
  ansible.builtin.uri:
    url: "{{ s3_manager_url }}/api/auth/api-tokens"
    method: POST
    headers:
      Authorization: "Bearer {{ s3m_login.json.access_token }}"
      Content-Type: "application/json"
    body_format: json
    body:
      name: "ansible-prod"
      expires_in_days: 180
    return_content: true
  register: s3m_api_token_create
  no_log: true

- name: Persist token securely (example: Ansible fact for current run)
  ansible.builtin.set_fact:
    s3m_api_token: "{{ s3m_api_token_create.json.access_token }}"
  no_log: true
```

### List existing tokens

```yaml
- name: List active API tokens
  ansible.builtin.uri:
    url: "{{ s3_manager_url }}/api/auth/api-tokens"
    method: GET
    headers:
      Authorization: "Bearer {{ s3m_login.json.access_token }}"
    return_content: true
  register: s3m_api_tokens

- name: Show token names
  ansible.builtin.debug:
    msg: "{{ s3m_api_tokens.json | map(attribute='name') | list }}"
```

### Use token for admin automation endpoint

```yaml
- name: Apply admin automation payload with API token
  ansible.builtin.uri:
    url: "{{ s3_manager_url }}/api/admin/automation/apply"
    method: POST
    headers:
      Authorization: "Bearer {{ s3m_api_token }}"
      Content-Type: "application/json"
    body_format: json
    body:
      dry_run: false
      continue_on_error: false
      ui_users:
        - state: present
          match:
            email: "alice@example.com"
          spec:
            full_name: "Alice"
            role: "ui_user"
            password: "{{ vault_alice_password }}"
    return_content: true
  register: s3m_apply

- name: Report changed status
  ansible.builtin.debug:
    msg: "Changed = {{ s3m_apply.json.changed }}"
```

### Revoke token

```yaml
- name: Revoke API token by id
  ansible.builtin.uri:
    url: "{{ s3_manager_url }}/api/auth/api-tokens/{{ token_id_to_revoke }}"
    method: DELETE
    headers:
      Authorization: "Bearer {{ s3m_login.json.access_token }}"
    status_code: 204
```

## Operational recommendations

- Use dedicated tokens per automation scope (`ansible-prod`, `ci-migrations`, ...).
- Store tokens in a secret manager (Vault, Kubernetes secret, CI protected secret).
- Set `no_log: true` on tasks that handle credentials.
- Rotate periodically and revoke immediately when a pipeline/user is decommissioned.

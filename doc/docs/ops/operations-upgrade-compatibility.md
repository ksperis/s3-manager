# Operations: Upgrade and Compatibility Notes

## 2026-08 canonical execution-context catalogue

The unused `GET /api/manager/accounts` endpoint has been removed. The frontend
already uses `GET /api/me/execution-contexts?workspace=manager`, whose explicit
context kinds and capabilities replace the heterogeneous account-shaped
response. Requests to the removed endpoint now return `404`. Canonical account
responses now always include a non-null Storage Endpoint ID, name, URL, and
capability map, plus an explicit default-endpoint flag. Execution-context
responses likewise always include endpoint name, URL, default flag, and
capabilities; only the endpoint ID remains nullable for custom connections.

## 2026-08 removal of the dead Portal key setting

Migration `0093_remove_dead_portal_key_setting` removes `allow_portal_key`
from global application settings and account-level Portal overrides. The flag
was persisted and exposed by the API but never affected Portal behavior.

Deploy the migration, backend, and frontend together. Portal settings payloads
containing the removed field are rejected, including custom bootstrap JSON
files. Invalid bootstrap files now fail explicitly instead of silently loading
defaults. Downgrade does not recreate this no-op value.

## 2026-08 canonical Portal access-key bucket field

Portal access-key responses now expose the selected S3 bucket only as
`bucket_name`. The duplicate response field `storage_space_id` has been
removed; it remains the request field used when creating an external key.
Deploy the backend and frontend together.

## 2026-08 canonical UI user roles

Migration `0092_canonical_user_roles` converts `users.role` to exactly one of
`ui_superadmin`, `ui_admin`, `ui_user`, or `ui_none`, installs a database check
constraint, and sets the database default to `ui_user`. Known historical names
are mapped to their canonical role; unknown or empty values become `ui_none` so
the migration never widens access.

Deploy the migration, backend, and frontend together. Admin user APIs and
automation payloads reject removed role names with `422`, and the frontend no
longer repairs roles from API responses or persisted sessions. Downgrade drops
the constraint but does not recreate historical role spellings.

## 2026-08 control-plane audit boundary

Migration `0091_purge_data_plane_audit_logs` irreversibly removes historical
object data-plane actions and non-audit operational noise from `audit_logs`.
Take a verified application database backup immediately before applying it;
downgrade is intentionally unsupported and recovery requires restoring that
backup. Deploy the migration, backend, and frontend together.

The application audit now contains only control-plane, security,
configuration, and global workflow-control events. Object evidence moves to
Server Access Logging or the provider's equivalent. Portal clients must use
`/api/portal/access-logs`, `/page`, and `/raw`; the removed
`/api/portal/transfers` and
`/api/portal/transfers/server-access-logs*` routes return `404`. The new access
log routes do not accept `mode` and expose all S3 categories with action,
space, path, identity, and result filters.

## 2026-08 canonical bucket migration JSON state

Migration `0090_canonical_bucket_migration_json` rewrites persisted bucket
migration reports, snapshots, plans, replication state, policy backups, diff
samples, and event metadata to JSON objects or SQL `NULL`. Invalid operational
state becomes `NULL`, forcing safe recomputation or a new precheck. Historical
diff and event values remain available under `value` or `unparsed` envelopes.
The absence of an original bucket policy is now stored directly as SQL `NULL`
instead of the JSON scalar `null`.

Deploy the migration and backend together. Worker and API readers now reject
malformed or non-object persisted JSON rather than silently treating it as
missing state. The cleanup is not reversed on downgrade.

## 2026-08 canonical custom S3 connection endpoints

Migration `0089_canonical_s3_connection_endpoints` rewrites every manual S3
connection endpoint with the exact current fields, maps the removed
`provider_hint` key to `provider`, supplies current boolean defaults, and clears
custom JSON from connections bound to a registered Storage Endpoint. The
migration stops with the affected connection ID if a manual connection has no
usable endpoint URL; repair or delete that invalid row before retrying.

Deploy the migration and backend together. Runtime readers now reject malformed,
partial, or unknown custom endpoint data instead of repairing it or consulting
removed model attributes. Registered endpoints also propagate their configured
TLS verification flag to connections. The cleanup is not reversed on downgrade.

## 2026-08 canonical account Portal settings overrides

Migration `0088_canonical_portal_settings_override` replaces the historical
`{"admin": {...}}` envelope with the direct `PortalSettingsOverride` object.
It removes obsolete `portal_manager` data and unknown or invalid fields while
retaining every valid current override. Empty, malformed, and non-object values
become `NULL`, the canonical representation of no account override.

Deploy the migration and backend together. The backend no longer unwraps old
payloads or hides invalid persisted values, and the API rejects unknown override
fields. The data cleanup is not reversed on downgrade.

## 2026-08 canonical audit metadata

Migration `0087_canonical_audit_metadata` rewrites every non-null audit metadata
payload as a JSON object. Existing objects retain their fields, other valid JSON
values move under `value`, and malformed historical text moves under `unparsed`
so old audit evidence is not discarded. New oversized metadata uses a bounded,
valid JSON envelope with a preview and the original serialized length.

Deploy the migration and backend together. Audit and Portal readers now share a
strict object contract instead of hiding malformed storage independently. The
data cleanup is not reversed on downgrade.

## 2026-08 canonical billing operation breakdowns

Migration `0086_canonical_billing_ops_breakdown` rewrites each available daily
operation breakdown as a JSON object mapping operation names to integer counts.
Malformed, non-object, and empty payloads become `NULL`, which remains the
canonical representation when detailed operation data was not collected.

Deploy the migration and backend together. Billing aggregation now rejects any
remaining non-canonical breakdown instead of skipping it or coercing values at
runtime. The data cleanup is not reversed on downgrade.

## 2026-08 canonical bucket usage statistics JSON

Migration `0085_canonical_bucket_usage_stats_json` rewrites every persisted
bucket distribution as a JSON list of objects and every non-null warning set as
a JSON list of strings. Malformed containers and entries are removed once;
`warnings_json = NULL` remains the canonical representation of no warnings.

Deploy the migration and backend together. Snapshot loading now validates every
distribution entry and warning instead of returning empty data for malformed
storage. The data cleanup is not reversed on downgrade.

## 2026-08 canonical managed-access IAM state

Migration `0084_canonical_managed_access_iam_lists` rewrites the tracked IAM
groups, managed policies, and inline policy names for every managed private
access as ordered, deduplicated JSON lists of non-empty strings. Malformed or
non-list values become empty lists.

Deploy the migration and backend together. Saga replay and cleanup now reject
any remaining malformed or non-string IAM state instead of coercing or dropping
values at runtime. The data cleanup is not reversed on downgrade.

## 2026-08 legacy Portal application settings

Migration `0099_migrate_legacy_portal_app_settings` updates every database-backed
application settings payload that still uses the former Portal contract. It
renames `allow_portal_user_bucket_create` to
`allow_private_storage_space_create` without overwriting an existing current
value, and removes the obsolete `bucket_access_policy`,
`iam_group_manager_policy`, and `iam_group_user_policy` fields. Deployments that
already applied the equivalent manual repair are left unchanged.

The migration validates all rows before writing any update. It stops explicitly
when a payload or its `portal` section is not a JSON object, or when the legacy
create setting is not a boolean. Restore or correct that source value before
retrying the upgrade. The optional `APP_SETTINGS_PATH` bootstrap file is outside
Alembic's database scope and must already use the current field names. Removed
policy values and renamed settings are not reconstructed on downgrade.

## 2026-08 canonical UI-managed OIDC scopes

Migration `0083_canonical_oidc_provider_scopes` rewrites every UI-managed OIDC
scope set as a non-empty JSON list of trimmed strings. Empty, malformed, or
non-list values receive the current `openid`, `email`, and `profile` defaults.

Deploy the migration and backend together. OIDC provider loading now rejects
any remaining malformed, empty, or non-string scope set instead of repairing it
at runtime. The ORM and database defaults are also aligned. Data cleanup is not
reversed on downgrade.

## 2026-08 canonical persisted application settings

Migration `0082_canonical_app_settings_payload` rewrites every database-backed
application settings payload as a JSON object and replaces malformed or
non-object values with `{}`. Valid object fields remain unchanged.

Deploy the migration and backend together. Once settings have been imported to
the database, loading now uses the strict `AppSettings` contract and exposes
invalid values instead of reverting silently to defaults. The optional disk
bootstrap keeps its independent missing/invalid-file fallback. Data cleanup is
not reversed on downgrade.

## 2026-08 canonical Portal request JSON

Migration `0081_canonical_portal_request_json` rewrites every Portal request
payload and non-null result as a JSON object. Malformed and non-object values
become `{}` while an absent result remains `NULL` for undecided requests.

Deploy the migration and backend together. Portal request execution and API
serialization now reject any remaining malformed or non-object JSON instead of
repairing it at runtime. The data cleanup is not reversed on downgrade.

## 2026-08 canonical user notification payloads

Migration `0080_canonical_user_notification_payloads` rewrites notification
payloads as JSON objects, replaces null or malformed values with `{}`, and makes
`user_notifications.payload_json` non-nullable with the same database default.

Deploy the migration and backend together. Notification serialization now
rejects non-object or malformed payloads instead of silently returning an empty
object. Downgrade makes the column nullable again but keeps canonicalized data.

## 2026-08 canonical user UI preferences

Migration `0079_canonical_user_ui_preferences` rewrites every persisted user UI
preference payload to the current `theme` and `selected_portal_account_id`
contract. Malformed or invalid payloads become empty preferences, removed fields
are discarded, and account identifiers are trimmed.

Deploy the migration and backend together. The backend now treats any remaining
non-canonical payload as data corruption instead of repairing it during profile
serialization. The data cleanup is intentionally not reversed on downgrade.

## 2026-08 normalized tags only

Migration `0078_remove_legacy_tags_json` removes the `tags_json` mirrors from
storage endpoints, S3 accounts, S3 users, and S3 connections. Normalized tag
definitions and ordered link tables have been the only read source since their
introduction; the backend now writes only that canonical model.

Deploy the migration and backend together because older instances still write
the removed columns. Downgrade recreates each JSON mirror from the normalized
links in stored order, but the current backend never reads or maintains it.

## 2026-08 canonical S3 connection capabilities

Migration `0077_canonical_s3_connection_capabilities` rewrites every cached S3
connection capability profile to a JSON object containing the required boolean
`can_manage_iam`. Malformed profiles and the removed `iam_capable` key resolve
to the safe value `false`; unrelated current extension fields are retained. The
database default is changed to the same canonical profile.

Deploy the migration and backend together. The backend now treats missing,
malformed, or non-canonical profiles as data corruption instead of repairing
them at runtime. Downgrade restores the old empty-object default but cannot
recreate discarded malformed or legacy values.

## 2026-08 schema index reconciliation

Migration `0076_remove_redundant_provider_indexes` removes the non-unique LDAP
and OIDC `provider_id` indexes that duplicated the existing unique constraints.
It does not rewrite provider data or weaken uniqueness. The SQLAlchemy metadata
now also reflects the indexes already installed by earlier migrations, and the
full Alembic head is checked against that metadata in the backend test suite.

## 2026-08 canonical S3 session capabilities

Migration `0075_canonical_s3_session_capabilities` materializes a complete
capability snapshot for every existing direct S3 session, replaces missing or
malformed snapshots with the current safe defaults, and makes
`s3_sessions.capabilities` non-nullable. The backend no longer repairs invalid
session capability data at runtime.

Stop backend instances while applying the migration so no session is created
during the table alteration. Existing direct S3 sessions remain usable with
their canonicalized snapshot. Downgrade makes the column nullable again but
does not recreate missing or malformed values; deploy matching code if a
downgrade is unavoidable.

## 2026-08 timezone-aware UTC migration

Migration `0074_timezone_aware_utc_timestamps` converts every persisted
PostgreSQL timestamp to `TIMESTAMP WITH TIME ZONE`. Existing values are
interpreted explicitly as UTC during the conversion; no server or session
timezone is consulted. The application now rejects timezone-naive datetime
writes and serializes persisted values with an explicit UTC offset.

Stop all backend instances and workers before applying the migration, because
old code still writes and compares naive values. Back up the database, run
Alembic through revision `0074`, then deploy the backend and frontend together.
On large PostgreSQL tables, plan a maintenance window: each altered table is
locked while PostgreSQL rewrites or validates its timestamp columns.

SQLite has no timezone-bearing timestamp storage, so the migration does not
rewrite its columns. The SQLAlchemy adapter still rejects naive application
writes, stores the normalized UTC wall-clock representation, and restores an
aware UTC value on every read. Back up the database, `-wal`, and `-shm` files as
one consistent set before upgrading.

Downgrade converts PostgreSQL values back to timezone-naive UTC. It does not
restore the old application contract; deploy compatible code at the same time
if a downgrade is unavoidable.

## 2026-08 managed private access migration

Migration `0070_managed_private_access` is DB-only. It adds
`s3_connections.server_managed` with a false default and creates the durable
`managed_private_accesses` saga table. Existing connections and remote RGW/IAM
resources are not modified, adopted, or contacted during Alembic.

Deploy backend and frontend together so Manager does not expose a provisioning
action before the specialized endpoints and immutable-credential rules are
available. After upgrade, smoke-test both **Create my private access** branches,
Profile deletion, and **Retry cleanup**. A `cleanup_pending` row is operational
state, not disposable bookkeeping: retain it until the idempotent remote
cleanup succeeds.

Downgrade removes only the new table and marker column. It cannot clean up
remote identities or keys already created by the application; delete every
server-managed private connection through the running orchestrator before
downgrading.

## 2026-08 canonical access model migration

Migration `0069_canonical_account_access_roles` is a breaking, DB-only
migration. It replaces the two account-association dimensions with one ordered
`role`, removes the legacy columns in the same release, and makes shared S3
connections Manager-only.

The backend API accepts and returns only the canonical `role`; backend and
frontend must therefore be deployed together across this migration boundary.

### Required deployment sequence

Rolling upgrade is prohibited because old backend instances and workers still
expect the removed columns.

1. Stop old application instances and every background worker.
2. Create and verify a restorable database backup. For SQLite, include the
   database, `-wal`, and `-shm` files as one consistent set. For PostgreSQL,
   validate the dump by restoring it to a separate database.
3. If the migration reports associations without useful rights, set
   `S3_MANAGER_DB_BACKUP_VERIFIED=true` only after that restore verification.
   Empty databases and databases without such associations do not require this
   override.
4. Run Alembic through revision `0069` while the old processes remain stopped.
5. Deploy the new backend and frontend together, then start new workers.
6. Run `python -m app.scripts.reconcile_portal_iam` first in its default dry-run
   mode. Review the per-account summary and then rerun with `--apply`.
7. Smoke-test Admin associations, shared-connection remediation, empty/private
   Browser, Manager Browser, Portal, direct S3 sessions, and Ceph Admin Browser.

Alembic never contacts RGW. Portal IAM reconciliation is intentionally a
separate, resumable command; a partial IAM failure must not alter the canonical
database role.

### Data transformation

- `portal_user`, `portal_manager`, and `account_administrator` are the only
  stored account roles.
- Root account links always become `account_administrator`.
- A legacy admin flag outranks a legacy Portal role.
- Associations that previously granted no useful right are **deleted**, not
  retained with `role = NULL`. No tombstone or compatibility row is written.
- Shared connections have Browser access disabled. Those with Manager access
  stay ready; the others receive the stable remediation reason
  `shared_connection_manager_access_disabled`.
- Private connection owners, credentials, activity flags, and access flags are
  unchanged.

The downgrade reconstructs the legacy schema and fields for surviving rows. It
cannot recreate deleted no-right associations; restoring the verified backup is
the only recovery path for that explicitly non-reversible data.

## 2026-07 Portal Storage Space access migration

Migration `0066_portal_storage_space_access_model` clears the database state of
existing Portal Storage Spaces before installing the strict private/team access
model. It removes their grants, external-credential records, and public links.
It does not contact RGW or delete storage-side resources.

1. Back up the application database and record the spaces that must be recreated.
2. Before upgrading, remove the old Storage Spaces and revoke their external IAM
   credentials through the application workflow. This must happen before Alembic
   because a database migration cannot revoke RGW-side credentials.
3. Apply the database migration. Any remaining Portal database metadata is
   purged transactionally; unrelated public links are preserved.
4. Recreate private spaces or re-import team spaces so bucket policies, IAM
   identities, and fixed Portal groups are provisioned with the strict model.

There is no runtime conversion or compatibility path for old Owner grants,
shared-space owners, or editable Portal IAM policies.

## 2026-08 S3 connection credential owner types

Migration `0073_canonical_connection_owner_types` makes connection identity
metadata strict. It converts `rgw_user` to the canonical `s3_user`, trims and
normalizes the supported values, clears unsupported owner types, and installs a
database constraint. The only stored values are now `iam_user`, `account_user`,
`s3_user`, or `NULL`.

The downgrade removes the constraint but does not recreate noncanonical values.
Back up the application database before the migration if those values must be
inspected or exported.

## 2026-08 canonical S3 user endpoints

Migration `0094_canonical_s3_user_endpoints` assigns every detached S3 user to
the current default Ceph endpoint, then makes `s3_users.storage_endpoint_id`
non-nullable. Before upgrading, verify that a Ceph endpoint is marked as the
default. The migration stops with an explicit error when detached users exist
without such an endpoint; it does not guess another backend or retain a runtime
fallback.

After this boundary, S3 user creation and import APIs require
`storage_endpoint_id`. Existing S3 users cannot change endpoint. Deploy the
backend and frontend together because the request and response contracts are
both strict.

## 2026-08 canonical S3 account endpoints

Migration `0095_canonical_s3_account_endpoints` assigns every detached S3
account to the current default Ceph endpoint, then makes
`s3_accounts.storage_endpoint_id` non-nullable. Before upgrading, verify that a
Ceph endpoint is marked as the default. The migration stops with an explicit
error when detached accounts exist without such an endpoint; it does not retain
a runtime fallback.

After this boundary, S3 account creation and import APIs require
`storage_endpoint_id`, and update requests reject an explicit `null` endpoint.
Account-specific RGW operations always use the persisted endpoint. Deploy the
backend and frontend together because the request and response contracts are
both strict.

## 2026-08 canonical secret keyrings

The backend now accepts only the keyring settings `JWT_KEYS` and
`CREDENTIAL_KEYS`. Before upgrading, replace a singular `FERNET_KEY` with a
one-item `JWT_KEYS` list and replace a singular `CREDENTIAL_KEY` with a one-item
`CREDENTIAL_KEYS` list. Keep every historical key required to validate active
JWTs or decrypt stored credentials, with the key used for new values first.

Empty keyrings are rejected at startup. The singular environment variables are
ignored and no longer provide runtime compatibility.

## 2026-08 strict credential encryption

Migration `0098_encrypt_plaintext_secrets` encrypts any remaining plaintext
credentials in storage endpoints, S3 accounts, IAM users, S3 users, S3
connections, authentication providers, and S3 sessions. After this boundary,
the ORM rejects plaintext or otherwise unreadable values instead of returning
them as usable secrets.

Before upgrading, configure `CREDENTIAL_KEYS` with the current key followed by
every historical credential key still needed by the database. The migration
stops when a stored Fernet token cannot be decrypted, rather than encrypting an
unreadable token a second time. Its downgrade keeps credentials encrypted.

## 2026-08 Manager Browser active context

Migration `0103_manager_browser_data_access` adds the non-null
`allow_manager_browser_data_access` flag to UI-user and UI-group associations
with S3 Accounts and RGW users. The secure default is `false`; no existing
association is enabled automatically.

Deploy the backend and frontend together. The embedded `/manager/browser` now
uses the active Manager `ctx` and sends `X-S3-Workspace: manager-browser` on all
Browser API calls. An older frontend will not send that explicit surface, while
an older backend cannot enforce the new per-association permission. After
deployment, verify Account, RGW-user, owned private-connection, shared-
connection, and immediate-revocation scenarios. Standalone `/browser`, Portal,
and Ceph Admin Browser execution policies are unchanged.

## 2026-08 canonical S3 user execution context

The execution-context API now reports managed RGW users with
`kind="s3_user"`. The obsolete `legacy_user` value is rejected throughout the
backend and frontend; no runtime alias is retained. Context identifiers remain
`s3u-<id>`, so persisted bucket migrations and workspace selections do not
require a database migration. Deploy the backend and frontend together.

## 2026-08 canonical S3 user association payloads

Admin user and group writes now accept only structured `s3_user_links` entries.
The obsolete `s3_user_ids` request field is rejected with `422`; every link
must state its `s3_user_id` and may explicitly enable
`allow_manager_browser_data_access`. Responses continue to expose the
association details needed by the frontend. The duplicate `accounts`,
`s3_users`, and `s3_connections` identifier arrays are no longer returned by
Admin user or group responses; consume `account_links`, `s3_user_links`, and
`s3_connection_details` instead. The nested `effective_access` projection also
stops duplicating canonical links and details through `accounts`, `s3_users`,
`s3_connections`, and `manager_browser_s3_users`. Admin user responses expose
group membership only through `group_details`, and group responses expose
members only through `user_details`; the duplicate `group_ids` and `user_ids`
response fields are removed. Deploy the backend and frontend together.

## 2026-08 canonical RGW user principal links

Admin RGW user responses now expose UI-user and UI-group associations only
through `user_links` and `group_links`. The duplicate `user_ids`, `user_details`,
`group_ids`, and `group_details` response fields are removed. Updates also accept
only the structured link fields; sending `user_ids` or `group_ids` returns `422`.
Deploy the backend and frontend together.

## 2026-08 canonical S3 connection principal details

Admin S3 connection responses no longer duplicate `user_details` and
`group_details` through `user_ids` and `group_ids`. The structured details are
the only response representation. The `group_ids` update field remains the
canonical write contract for replacing group links. Deploy the backend and
frontend together.

## 2026-08 canonical RGW account principal links

Admin RGW account responses and minimal summaries now expose UI-user and
UI-group associations only through `user_links` and `group_links`. The duplicate
`user_ids` and `group_ids` response fields are removed. Updates also accept only
the structured link fields, which require an explicit role for every principal;
sending `user_ids`, `group_ids`, or a null link list returns `422`. Send an empty
list to clear an association set. The obsolete `is_s3_user` discriminator is
also removed because these endpoints return RGW accounts exclusively. Consumers
that operate on mixed execution contexts must use the canonical `kind` field.
The unused `root_user_email` and `root_user_id` projections are no longer
returned, eliminating per-account root-link lookups. Account response models now
reject unknown fields internally so obsolete projections cannot be silently
reintroduced. Deploy the backend and frontend together.

## 2026-03 compatibility cleanup

Current behavior after cleanup:

- API context selectors reject legacy account inputs (`-1`, `null`, negative ids) with `400`.
- Frontend context persistence uses the independent
  `selectedManagerExecutionContextId` and `selectedBrowserExecutionContextId`
  preferences, with `ctx` as the authoritative URL parameter in each tab.
- Legacy shared local storage keys (`selectedExecutionContextId`,
  `selectedS3AccountId`, and `selectedBrowserContextId`) are ignored.
- Removed runtime env flags `BILLING_ENABLED` and `HEALTHCHECK_ENABLED` are no
  longer accepted; use the explicit `FEATURE_BILLING_ENABLED` and
  `FEATURE_ENDPOINT_STATUS_ENABLED` force-locks.

## Operator guidance

- Remove scripts relying on legacy selector values.
- Validate UI context persistence after upgrades.
- Use explicit `FEATURE_*` controls for forced feature state.
- Back up the application database before migrations.
- Confirm the credential encryption key is unchanged after restore or redeploy.
- Validate the Admin, Manager, Portal, and Browser entry routes with the intended roles after upgrade.

## Related pages

- [Configuration](configuration.md)
- [Production readiness](production-readiness.md)
- [Backup and restore](backup-restore.md)
- [Developer docs maintenance](../developer/docs-maintenance.md)

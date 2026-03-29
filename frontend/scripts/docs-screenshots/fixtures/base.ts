import type { MockRule } from "../types";

const NOW = "2026-03-08T09:00:00Z";

const ADMIN_ACCOUNTS_MINIMAL = [
  {
    id: "101",
    db_id: 101,
    name: "Helios Retail",
    tags: [{ id: 901, label: "prod", color_key: "emerald", scope: "standard" }],
    user_ids: [1, 2, 3],
    user_links: [
      { user_id: 1, account_admin: true, user_email: "admin.docs@example.com" },
      { user_id: 2, account_admin: true, user_email: "platform.admin@example.com" },
      { user_id: 3, account_admin: false, user_email: "storage.user@example.com" },
    ],
    rgw_account_id: "RGW-HELIOS",
    storage_endpoint_id: 11,
    storage_endpoint_name: "Default",
    storage_endpoint_url: "https://s3-default.docs.example.com",
  },
  {
    id: "102",
    db_id: 102,
    name: "Northwind Ops",
    tags: [{ id: 902, label: "ops", color_key: "sky", scope: "standard" }],
    user_ids: [2],
    user_links: [{ user_id: 2, account_admin: true, user_email: "platform.admin@example.com" }],
    rgw_account_id: "RGW-NORTHWIND",
    storage_endpoint_id: 12,
    storage_endpoint_name: "Archive",
    storage_endpoint_url: "https://s3-archive.docs.example.com",
  },
];

const ADMIN_UI_USERS = [
  {
    id: 1,
    email: "admin.docs@example.com",
    role: "ui_superadmin",
    can_access_ceph_admin: true,
    can_access_storage_ops: true,
    accounts: [101],
    account_links: [{ account_id: 101, account_admin: true }],
    s3_users: [901],
    s3_user_details: [{ id: 901, name: "helios-admin" }],
    s3_connections: [701],
    s3_connection_details: [{ id: 701, name: "BlueHarbor Shared Connection", access_manager: true, access_browser: true }],
    last_login_at: "2026-03-08T08:45:00Z",
  },
  {
    id: 2,
    email: "platform.admin@example.com",
    role: "ui_admin",
    can_access_ceph_admin: true,
    can_access_storage_ops: true,
    accounts: [101, 102],
    account_links: [
      { account_id: 101, account_admin: true },
      { account_id: 102, account_admin: true },
    ],
    s3_users: [903],
    s3_user_details: [{ id: 903, name: "platform-admin" }],
    s3_connections: [701],
    s3_connection_details: [{ id: 701, name: "BlueHarbor Shared Connection", access_manager: true, access_browser: true }],
    last_login_at: "2026-03-08T08:15:00Z",
  },
  {
    id: 3,
    email: "storage.user@example.com",
    role: "ui_user",
    can_access_ceph_admin: false,
    can_access_storage_ops: true,
    accounts: [101],
    account_links: [{ account_id: 101, account_admin: false }],
    s3_users: [904],
    s3_user_details: [{ id: 904, name: "storage-user-helios" }],
    s3_connections: [701],
    s3_connection_details: [{ id: 701, name: "BlueHarbor Shared Connection", access_manager: true, access_browser: true }],
    last_login_at: "2026-03-07T17:20:00Z",
  },
];

const ADMIN_STORAGE_ENDPOINTS = [
  {
    id: 11,
    name: "Default",
    endpoint_url: "https://s3-default.docs.example.com",
    admin_endpoint: "https://rgw-admin.docs.example.com",
    region: "eu-west-1",
    verify_tls: true,
    provider: "ceph",
    admin_access_key: "S3MADMINDEFAULT",
    has_admin_secret: true,
    supervision_access_key: "S3MSUPDEFAULT",
    has_supervision_secret: true,
    ceph_admin_access_key: "S3MCEPHDEFAULT",
    has_ceph_admin_secret: true,
    capabilities: {
      admin: true,
      account: true,
      sts: false,
      usage: true,
      metrics: true,
      static_website: true,
      iam: true,
      sns: true,
      sse: true,
    },
    features: {
      admin: { enabled: true, endpoint: "https://rgw-admin.docs.example.com" },
      account: { enabled: true },
      sts: { enabled: false },
      usage: { enabled: true },
      metrics: { enabled: true },
      static_website: { enabled: true },
      iam: { enabled: true },
      sns: { enabled: true },
      sse: { enabled: true },
      healthcheck: { enabled: true, mode: "http", url: "https://s3-default.docs.example.com/health" },
    },
    is_default: true,
    is_editable: true,
    tags: [
      { id: 951, label: "prod", color_key: "emerald", scope: "standard" },
      { id: 952, label: "rgw-a", color_key: "sky", scope: "administrative" },
    ],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: NOW,
  },
  {
    id: 12,
    name: "Archive",
    endpoint_url: "https://s3-archive.docs.example.com",
    admin_endpoint: null,
    region: "eu-west-2",
    verify_tls: true,
    provider: "other",
    admin_access_key: null,
    has_admin_secret: false,
    supervision_access_key: null,
    has_supervision_secret: false,
    ceph_admin_access_key: null,
    has_ceph_admin_secret: false,
    capabilities: {
      admin: false,
      account: false,
      sts: false,
      usage: false,
      metrics: false,
      static_website: false,
      iam: true,
      sns: false,
      sse: true,
    },
    features: {
      admin: { enabled: false, endpoint: null },
      account: { enabled: false },
      sts: { enabled: false },
      usage: { enabled: false },
      metrics: { enabled: false },
      static_website: { enabled: false },
      iam: { enabled: true },
      sns: { enabled: false },
      sse: { enabled: true },
      healthcheck: { enabled: true, mode: "http", url: "https://s3-archive.docs.example.com/health" },
    },
    is_default: false,
    is_editable: false,
    tags: [{ id: 953, label: "archive", color_key: "slate", scope: "standard" }],
    created_at: "2026-01-15T00:00:00Z",
    updated_at: NOW,
  },
];

const GENERAL_SETTINGS = {
  manager_enabled: true,
  ceph_admin_enabled: true,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: true,
  browser_ceph_admin_enabled: true,
  billing_enabled: false,
  endpoint_status_enabled: true,
  bucket_migration_enabled: true,
  bucket_compare_enabled: true,
  allow_ui_user_bucket_migration: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: true,
  allow_login_custom_endpoint: false,
  allow_user_private_connections: true,
};

const LOGIN_SETTINGS = {
  allow_login_access_keys: false,
  allow_login_endpoint_list: true,
  allow_login_custom_endpoint: false,
  default_endpoint_url: "https://s3-default.docs.example.com",
  endpoints: [
    { id: 11, name: "Default", endpoint_url: "https://s3-default.docs.example.com", is_default: true },
    { id: 12, name: "Archive", endpoint_url: "https://s3-archive.docs.example.com", is_default: false },
  ],
  login_logo_url: null,
  seed_login_prefill: false,
  seed_login_email: null,
  seed_login_password: null,
};

const EXECUTION_CONTEXTS = [
  {
    kind: "account",
    id: "acc-helios",
    display_name: "Helios Retail",
    manager_account_is_admin: true,
    rgw_account_id: "RGW-HELIOS",
    quota_max_size_gb: 3,
    quota_max_objects: 4000,
    endpoint_id: 11,
    endpoint_name: "Default",
    endpoint_provider: "ceph",
    endpoint_url: "https://s3-default.docs.example.com",
    storage_endpoint_capabilities: {
      iam: true,
      sns: true,
      usage: true,
      metrics: true,
      static_website: true,
      sts: false,
    },
    capabilities: {
      can_manage_iam: true,
      sts_capable: false,
      admin_api_capable: true,
    },
  },
  {
    kind: "connection",
    id: "conn-blueharbor",
    display_name: "BlueHarbor Shared Connection",
    manager_account_is_admin: false,
    endpoint_id: 12,
    endpoint_name: "Archive",
    endpoint_provider: "other",
    endpoint_url: "https://s3-archive.docs.example.com",
    storage_endpoint_capabilities: {
      iam: false,
      sns: true,
      usage: true,
      metrics: false,
      static_website: false,
      sts: false,
    },
    capabilities: {
      can_manage_iam: false,
      sts_capable: false,
      admin_api_capable: false,
    },
  },
];

const MANAGER_BUCKETS = [
  {
    name: "helios-retail-logs",
    creation_date: "2026-02-28T08:00:00Z",
    owner: "RGW-HELIOS",
    owner_name: "Helios Platform",
    used_bytes: 182_554_321,
    object_count: 1284,
    tags: [
      { key: "env", value: "prod" },
      { key: "team", value: "platform" },
    ],
    features: {
      versioning: { state: "enabled", tone: "active" },
      cors: { state: "configured", tone: "active" },
      lifecycle: { state: "configured", tone: "active" },
      policy: { state: "configured", tone: "active" },
    },
  },
  {
    name: "helios-retail-backups",
    creation_date: "2026-02-27T12:00:00Z",
    owner: "RGW-HELIOS",
    owner_name: "Helios Backup",
    used_bytes: 902_122_001,
    object_count: 342,
    tags: [{ key: "env", value: "prod" }],
    features: {
      versioning: { state: "enabled", tone: "active" },
      lifecycle: { state: "configured", tone: "active" },
      cors: { state: "disabled", tone: "inactive" },
    },
  },
  {
    name: "blueharbor-curated",
    creation_date: "2026-02-20T09:30:00Z",
    owner: "RGW-BLUEHARBOR",
    owner_name: "BlueHarbor Data",
    used_bytes: 44_200_123,
    object_count: 96,
    tags: [{ key: "env", value: "staging" }],
    features: {
      versioning: { state: "disabled", tone: "inactive" },
      cors: { state: "configured", tone: "active" },
      lifecycle: { state: "not_set", tone: "inactive" },
    },
  },
];

const IAM_USERS = [
  { name: "analytics-reader", arn: "arn:aws:iam::111111111111:user/analytics-reader", groups: ["analytics"], policies: ["ReadOnlyAccess"] },
  { name: "backup-operator", arn: "arn:aws:iam::111111111111:user/backup-operator", groups: ["ops"], policies: ["AmazonS3FullAccess"] },
];

const IAM_GROUPS = [
  { name: "analytics", arn: "arn:aws:iam::111111111111:group/analytics", policies: ["ReadOnlyAccess"] },
  { name: "ops", arn: "arn:aws:iam::111111111111:group/ops", policies: ["AmazonS3FullAccess"] },
];

const IAM_POLICIES = [
  { name: "ReadOnlyAccess", arn: "arn:aws:iam::aws:policy/ReadOnlyAccess", path: "/", default_version_id: "v1" },
  { name: "AmazonS3FullAccess", arn: "arn:aws:iam::aws:policy/AmazonS3FullAccess", path: "/", default_version_id: "v1" },
];

const TOPICS = [
  {
    name: "object-events",
    arn: "arn:aws:sns:us-east-1:111111111111:object-events",
    owner: "111111111111",
    subscriptions_confirmed: 2,
    subscriptions_pending: 1,
    configuration: { "verify-ssl": "true" },
  },
  {
    name: "billing-alerts",
    arn: "arn:aws:sns:us-east-1:111111111111:billing-alerts",
    owner: "111111111111",
    subscriptions_confirmed: 1,
    subscriptions_pending: 0,
    configuration: { "delivery-policy": "default" },
  },
];

const MANAGER_MIGRATIONS = [
  {
    id: 31,
    source_context_id: "acc-helios",
    target_context_id: "conn-blueharbor",
    mode: "pre_sync",
    copy_bucket_settings: true,
    delete_source: false,
    strong_integrity_check: true,
    lock_target_writes: true,
    use_same_endpoint_copy: false,
    auto_grant_source_read_for_copy: false,
    webhook_url: null,
    mapping_prefix: "mig-",
    status: "running",
    pause_requested: false,
    cancel_requested: false,
    precheck_status: "passed",
    precheck_report: null,
    precheck_checked_at: NOW,
    parallelism_max: 8,
    total_items: 4,
    completed_items: 2,
    failed_items: 0,
    skipped_items: 0,
    awaiting_items: 0,
    error_message: null,
    started_at: NOW,
    finished_at: null,
    last_heartbeat_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 32,
    source_context_id: "acc-helios",
    target_context_id: "conn-blueharbor",
    mode: "one_shot",
    copy_bucket_settings: false,
    delete_source: false,
    strong_integrity_check: false,
    lock_target_writes: false,
    use_same_endpoint_copy: false,
    auto_grant_source_read_for_copy: false,
    webhook_url: null,
    mapping_prefix: "",
    status: "completed_with_errors",
    pause_requested: false,
    cancel_requested: false,
    precheck_status: "failed",
    precheck_report: { errors: 1, warnings: 1 },
    precheck_checked_at: NOW,
    parallelism_max: 4,
    total_items: 2,
    completed_items: 1,
    failed_items: 1,
    skipped_items: 0,
    awaiting_items: 0,
    error_message: "One bucket failed validation.",
    started_at: NOW,
    finished_at: NOW,
    last_heartbeat_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  },
];

const WORKSPACE_HEALTH = {
  generated_at: NOW,
  incident_highlight_minutes: 720,
  endpoint_count: 2,
  up_count: 1,
  degraded_count: 1,
  down_count: 0,
  unknown_count: 0,
  endpoints: [
    {
      endpoint_id: 11,
      name: "Default",
      endpoint_url: "https://s3-default.docs.example.com",
      status: "up",
      checked_at: NOW,
      latency_ms: 86,
      check_mode: "http",
      check_target_url: "https://s3-default.docs.example.com",
    },
    {
      endpoint_id: 12,
      name: "Archive",
      endpoint_url: "https://s3-archive.docs.example.com",
      status: "degraded",
      checked_at: NOW,
      latency_ms: 420,
      check_mode: "http",
      check_target_url: "https://s3-archive.docs.example.com",
    },
  ],
  incidents: [
    {
      endpoint_id: 12,
      endpoint_name: "Archive",
      endpoint_url: "https://s3-archive.docs.example.com",
      status: "degraded",
      start: NOW,
      end: null,
      duration_minutes: 18,
      check_mode: "http",
      ongoing: true,
      recent: true,
    },
  ],
};

const HEALTH_SUMMARY = {
  generated_at: NOW,
  endpoints: [
    {
      endpoint_id: 11,
      name: "Default",
      endpoint_url: "https://s3-default.docs.example.com",
      status: "up",
      checked_at: NOW,
      latency_ms: 82,
      http_status: 200,
      check_mode: "http",
      check_target_url: "https://s3-default.docs.example.com",
      error_message: null,
    },
    {
      endpoint_id: 12,
      name: "Archive",
      endpoint_url: "https://s3-archive.docs.example.com",
      status: "degraded",
      checked_at: NOW,
      latency_ms: 390,
      http_status: 200,
      check_mode: "http",
      check_target_url: "https://s3-archive.docs.example.com",
      error_message: "High latency",
    },
  ],
};

const BROWSER_SETTINGS = {
  allow_proxy_transfers: true,
  direct_upload_parallelism: 5,
  proxy_upload_parallelism: 3,
  direct_download_parallelism: 5,
  proxy_download_parallelism: 3,
  other_operations_parallelism: 3,
  streaming_zip_threshold_mb: 200,
};

const BROWSER_BUCKETS = [
  { name: "helios-retail-logs", creation_date: "2026-02-28T08:00:00Z" },
  { name: "helios-retail-backups", creation_date: "2026-02-27T12:00:00Z" },
  { name: "blueharbor-curated", creation_date: "2026-02-20T09:30:00Z" },
];

const BROWSER_OBJECTS_BY_BUCKET: Record<string, { prefixes: string[]; objects: Array<Record<string, unknown>> }> = {
  "helios-retail-logs": {
    prefixes: ["daily/", "monthly/"],
    objects: [
      {
        key: "daily/report-2026-03-08.json",
        size: 84_251,
        last_modified: NOW,
        etag: "\"3d4f1a\"",
        storage_class: "STANDARD",
      },
      {
        key: "daily/errors-2026-03-08.log",
        size: 12_520,
        last_modified: NOW,
        etag: "\"7ff129\"",
        storage_class: "STANDARD",
      },
      {
        key: "monthly/summary-2026-02.csv",
        size: 4_932,
        last_modified: NOW,
        etag: "\"8ddba1\"",
        storage_class: "STANDARD_IA",
      },
    ],
  },
  "helios-retail-backups": {
    prefixes: ["snapshots/"],
    objects: [
      {
        key: "snapshots/backup-2026-03-08.tar.gz",
        size: 1024 * 1024 * 380,
        last_modified: NOW,
        etag: "\"backup-001\"",
        storage_class: "STANDARD",
      },
    ],
  },
};

function normalizeBrowserPrefix(value: string | null): string {
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
}

function listBrowserObjectsForPrefix(
  value: { prefixes: string[]; objects: Array<Record<string, unknown>> },
  rawPrefix: string | null,
) {
  const prefix = normalizeBrowserPrefix(rawPrefix);
  if (!prefix) {
    return {
      prefixes: value.prefixes,
      objects: value.objects,
    };
  }

  const childPrefixes = new Set<string>();
  const objects = value.objects.filter((item) => {
    const key = typeof item.key === "string" ? item.key : "";
    if (!key.startsWith(prefix)) return false;
    const relative = key.slice(prefix.length);
    if (!relative) return false;
    if (relative.includes("/")) {
      const [segment] = relative.split("/");
      if (segment) {
        childPrefixes.add(`${prefix}${segment}/`);
      }
      return false;
    }
    return true;
  });

  const prefixes = value.prefixes
    .filter((candidate) => candidate.startsWith(prefix) && candidate !== prefix)
    .filter((candidate) => {
      const relative = candidate.slice(prefix.length).replace(/\/$/, "");
      return Boolean(relative) && !relative.includes("/");
    });

  childPrefixes.forEach((candidate) => prefixes.push(candidate));

  return {
    prefixes: Array.from(new Set(prefixes)).sort(),
    objects,
  };
}

const CEPH_ENDPOINTS = [
  {
    id: 11,
    name: "Default",
    endpoint_url: "https://s3-default.docs.example.com",
    admin_endpoint: "https://rgw-admin.docs.example.com",
    region: "eu-west-1",
    is_default: true,
    capabilities: {
      admin: true,
      usage: true,
      metrics: true,
      static_website: true,
      sns: true,
    },
  },
];

const CEPH_BUCKETS = {
  items: [
    {
      name: "helios-retail-logs",
      owner: "RGW58084876167649330",
      owner_name: "Helios Platform",
      used_bytes: 182_554_321,
      object_count: 1284,
      tags: [
        { key: "env", value: "prod" },
        { key: "team", value: "platform" },
      ],
      features: {
        versioning: { state: "enabled", tone: "active" },
        object_lock: { state: "disabled", tone: "inactive" },
        lifecycle: { state: "configured", tone: "active" },
      },
    },
    {
      name: "northwind-iot-events",
      owner: "RGW93423330686004300",
      owner_name: "Northwind Ops",
      used_bytes: 88_000_000,
      object_count: 4292,
      tags: [{ key: "env", value: "prod" }],
      features: {
        versioning: { state: "disabled", tone: "inactive" },
        lifecycle: { state: "configured", tone: "active" },
      },
    },
  ],
  total: 2,
  page: 1,
  page_size: 50,
  has_next: false,
};

function parseBucketName(pathname: string): string {
  const match = pathname.match(/\/buckets\/(.+?)(?:\/|$)/);
  return decodeURIComponent(match?.[1] ?? "helios-retail-logs");
}

export function buildBaseRules(): MockRule[] {
  return [
    {
      id: "branding",
      path: /^\/settings\/branding$/,
      body: { primary_color: "#0ea5e9", login_logo_url: null },
    },
    {
      id: "settings-general",
      path: /^\/settings\/general$/,
      body: GENERAL_SETTINGS,
    },
    {
      id: "settings-login",
      path: /^\/settings\/login$/,
      body: LOGIN_SETTINGS,
    },
    {
      id: "execution-contexts",
      path: /^\/me\/execution-contexts$/,
      body: ({ url }) => {
        const workspace = url.searchParams.get("workspace") ?? "manager";
        if (workspace === "browser") {
          return EXECUTION_CONTEXTS;
        }
        return EXECUTION_CONTEXTS;
      },
    },
    {
      id: "manager-context",
      path: /^\/manager\/context$/,
      body: ({ url }) => {
        const accountId = url.searchParams.get("account_id") ?? "acc-helios";
        const isConnection = accountId.startsWith("conn-");
        return {
          access_mode: isConnection ? "connection" : "admin",
          iam_identity: isConnection ? "conn-blueharbor" : "helios-admin",
          manager_stats_enabled: true,
          manager_browser_enabled: true,
        };
      },
    },
    {
      id: "admin-summary",
      path: /^\/admin\/stats\/summary$/,
      body: {
        total_accounts: 5,
        total_users: 7,
        total_admins: 2,
        total_none_users: 1,
        total_s3_users: 9,
        assigned_accounts: 4,
        unassigned_accounts: 1,
        assigned_s3_users: 6,
        unassigned_s3_users: 3,
        total_endpoints: 2,
        total_ceph_endpoints: 1,
        total_other_endpoints: 1,
        total_connections: 4,
        total_public_connections: 1,
        total_shared_connections: 2,
        total_private_connections: 1,
      },
    },
    {
      id: "admin-users",
      path: /^\/admin\/users$/,
      body: {
        items: ADMIN_UI_USERS,
        total: ADMIN_UI_USERS.length,
        page: 1,
        page_size: 25,
        has_next: false,
      },
    },
    {
      id: "admin-accounts-minimal",
      path: /^\/admin\/accounts\/minimal$/,
      body: ADMIN_ACCOUNTS_MINIMAL,
    },
    {
      id: "onboarding",
      path: /^\/admin\/onboarding$/,
      body: {
        dismissed: true,
        can_dismiss: true,
        seed_user_configured: true,
        endpoint_configured: true,
      },
    },
    {
      id: "health-summary",
      path: /^\/admin\/health\/summary$/,
      body: HEALTH_SUMMARY,
    },
    {
      id: "health-workspace-admin",
      path: /^\/admin\/health\/workspace-overview$/,
      body: WORKSPACE_HEALTH,
    },
    {
      id: "admin-storage-endpoints",
      path: /^\/admin\/storage-endpoints$/,
      body: ADMIN_STORAGE_ENDPOINTS,
    },
    {
      id: "admin-storage-endpoints-meta",
      path: /^\/admin\/storage-endpoints\/meta$/,
      body: {
        managed_by_env: false,
      },
    },
    {
      id: "manager-stats-overview",
      path: /^\/manager\/stats\/overview$/,
      body: {
        total_buckets: MANAGER_BUCKETS.length,
        total_iam_users: IAM_USERS.length,
        total_iam_groups: IAM_GROUPS.length,
        total_iam_roles: 2,
        total_iam_policies: IAM_POLICIES.length,
        total_bytes: MANAGER_BUCKETS.reduce((acc, item) => acc + (item.used_bytes ?? 0), 0),
        total_objects: MANAGER_BUCKETS.reduce((acc, item) => acc + (item.object_count ?? 0), 0),
        bucket_usage: MANAGER_BUCKETS.map((item) => ({ name: item.name, used_bytes: item.used_bytes, object_count: item.object_count })),
        bucket_overview: {
          bucket_count: MANAGER_BUCKETS.length,
          non_empty_buckets: MANAGER_BUCKETS.length,
          empty_buckets: 0,
          avg_bucket_size_bytes: 123456,
          avg_objects_per_bucket: 312,
          largest_bucket: { name: "helios-retail-backups", used_bytes: 902_122_001, object_count: 342 },
          most_objects_bucket: { name: "helios-retail-logs", used_bytes: 182_554_321, object_count: 1284 },
        },
      },
    },
    {
      id: "manager-health",
      path: /^\/manager\/stats\/endpoint-health$/,
      body: WORKSPACE_HEALTH,
    },
    {
      id: "manager-iam-overview",
      path: /^\/manager\/iam\/overview$/,
      body: {
        iam_users: IAM_USERS.length,
        iam_groups: IAM_GROUPS.length,
        iam_roles: 2,
        iam_policies: IAM_POLICIES.length,
        warnings: [],
      },
    },
    {
      id: "manager-buckets",
      path: /^\/manager\/buckets$/,
      body: MANAGER_BUCKETS,
    },
    {
      id: "manager-iam-users",
      path: /^\/manager\/iam\/users$/,
      body: IAM_USERS,
    },
    {
      id: "manager-iam-groups",
      path: /^\/manager\/iam\/groups$/,
      body: IAM_GROUPS,
    },
    {
      id: "manager-iam-policies",
      path: /^\/manager\/iam\/policies$/,
      body: IAM_POLICIES,
    },
    {
      id: "manager-topics",
      path: /^\/manager\/topics$/,
      body: TOPICS,
    },
    {
      id: "manager-topic-policy",
      path: /^\/manager\/topics\/[^/]+\/policy$/,
      body: {
        policy: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["SNS:Publish"], Resource: "*", Principal: "*" }],
        },
      },
    },
    {
      id: "manager-topic-config",
      path: /^\/manager\/topics\/[^/]+\/configuration$/,
      body: {
        configuration: {
          "delivery-policy": "default",
        },
      },
    },
    {
      id: "manager-migrations",
      path: /^\/manager\/migrations$/,
      body: {
        items: MANAGER_MIGRATIONS,
      },
    },
    {
      id: "ceph-endpoints",
      path: /^\/ceph-admin\/endpoints$/,
      body: CEPH_ENDPOINTS,
    },
    {
      id: "ceph-endpoint-access",
      path: /^\/ceph-admin\/endpoints\/\d+\/access$/,
      body: ({ url }) => {
        const endpointId = Number(url.pathname.split("/")[3] ?? 11);
        return {
          endpoint_id: endpointId,
          can_admin: true,
          can_accounts: true,
          can_metrics: true,
          admin_warning: null,
        };
      },
    },
    {
      id: "ceph-buckets",
      path: /^\/ceph-admin\/endpoints\/\d+\/buckets$/,
      body: CEPH_BUCKETS,
    },
    {
      id: "browser-settings",
      path: /^\/browser\/settings$/,
      body: BROWSER_SETTINGS,
    },
    {
      id: "browser-buckets-config-list",
      path: /^\/browser\/buckets\/config$/,
      body: MANAGER_BUCKETS,
    },
    {
      id: "browser-buckets-list",
      path: /^\/browser\/buckets$/,
      body: BROWSER_BUCKETS,
    },
    {
      id: "browser-buckets-search",
      path: /^\/browser\/buckets\/search$/,
      body: {
        items: BROWSER_BUCKETS,
        total: BROWSER_BUCKETS.length,
        page: 1,
        page_size: 50,
        has_next: false,
      },
    },
    {
      id: "browser-list-objects",
      path: /^\/browser\/buckets\/[^/]+\/objects$/,
      body: ({ url }) => {
        const bucketName = parseBucketName(url.pathname);
        const value = BROWSER_OBJECTS_BY_BUCKET[bucketName] ?? BROWSER_OBJECTS_BY_BUCKET["helios-retail-logs"];
        const filtered = listBrowserObjectsForPrefix(
          value,
          url.searchParams.get("prefix"),
        );
        return {
          prefix: url.searchParams.get("prefix") ?? "",
          objects: filtered.objects,
          prefixes: filtered.prefixes,
          is_truncated: false,
          next_continuation_token: null,
        };
      },
    },
    {
      id: "browser-versioning",
      path: /^\/browser\/buckets\/[^/]+\/versioning$/,
      body: {
        status: "Disabled",
        enabled: false,
      },
    },
    {
      id: "browser-versions",
      path: /^\/browser\/buckets\/[^/]+\/versions$/,
      body: {
        prefix: "",
        versions: [],
        delete_markers: [],
        is_truncated: false,
      },
    },
    {
      id: "browser-object-metadata",
      path: /^\/browser\/buckets\/[^/]+\/object-meta$/,
      body: {
        key: "daily/report-2026-03-08.json",
        size: 84_251,
        etag: "\"3d4f1a\"",
        last_modified: NOW,
        content_type: "application/json",
        metadata: {},
      },
    },
    {
      id: "browser-object-tags",
      path: /^\/browser\/buckets\/[^/]+\/object-tags$/,
      body: {
        key: "daily/report-2026-03-08.json",
        tags: [
          { key: "env", value: "prod" },
          { key: "source", value: "docs" },
        ],
      },
    },
    {
      id: "browser-bucket-cors",
      path: /^\/browser\/buckets\/[^/]+\/cors$/,
      body: {
        enabled: true,
        rules: [
          {
            allowed_origins: ["https://app.example.com"],
            allowed_methods: ["GET", "PUT", "POST"],
            allowed_headers: ["*"],
            expose_headers: [],
            max_age_seconds: 600,
          },
        ],
      },
    },
    {
      id: "browser-bucket-cors-status",
      path: /^\/browser\/buckets\/[^/]+\/cors-status$/,
      body: {
        enabled: true,
        rules: [
          {
            allowed_origins: ["https://app.example.com"],
            allowed_methods: ["GET", "PUT", "POST"],
            allowed_headers: ["*"],
            expose_headers: [],
            max_age_seconds: 600,
          },
        ],
      },
    },
    {
      id: "browser-sts-status",
      path: /^\/browser\/sts$/,
      body: {
        available: false,
        error: null,
      },
    },
    {
      id: "browser-sts-credentials",
      path: /^\/browser\/sts\/credentials$/,
      body: {
        access_key_id: "ASIADOCSTS",
        secret_access_key: "secret",
        session_token: "token",
        expiration: NOW,
        endpoint: "https://s3-default.docs.example.com",
        region: "eu-west-1",
      },
    },
    {
      id: "bucket-properties",
      path: /^\/(manager\/buckets|browser\/buckets\/config)\/[^/]+\/properties$/,
      body: {
        versioning_status: "Disabled",
        object_lock_enabled: false,
        object_lock: null,
        public_access_block: {
          block_public_acls: false,
          ignore_public_acls: false,
          block_public_policy: false,
          restrict_public_buckets: false,
        },
        lifecycle_rules: [],
        cors_rules: [
          {
            allowed_origins: ["https://app.example.com"],
            allowed_methods: ["GET", "PUT", "POST"],
          },
        ],
      },
    },
    {
      id: "bucket-policy",
      path: /^\/(manager\/buckets|browser\/buckets\/config)\/[^/]+\/policy$/,
      body: {
        policy: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*", Principal: "*" }],
        },
      },
    },
    {
      id: "bucket-logging",
      path: /^\/(manager\/buckets|browser\/buckets\/config)\/[^/]+\/logging$/,
      body: {
        enabled: true,
        target_bucket: "helios-retail-logs",
        target_prefix: "access/",
      },
    },
    {
      id: "bucket-website",
      path: /^\/(manager\/buckets|browser\/buckets\/config)\/[^/]+\/website$/,
      body: {
        index_document: "index.html",
        error_document: "error.html",
        redirect_all_requests_to: null,
        routing_rules: [],
      },
    },
  ];
}

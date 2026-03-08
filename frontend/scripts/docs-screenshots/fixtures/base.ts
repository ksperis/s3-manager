import type { MockRule } from "../types";

const NOW = "2026-03-08T09:00:00Z";

const GENERAL_SETTINGS = {
  manager_enabled: true,
  ceph_admin_enabled: true,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: true,
  browser_portal_enabled: true,
  browser_ceph_admin_enabled: true,
  allow_portal_manager_workspace: true,
  portal_enabled: true,
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

const PORTAL_ACCOUNTS = [
  {
    id: "acc-helios",
    name: "Helios Retail",
    quota_max_size_gb: 10,
    quota_max_objects: 100_000,
    rgw_account_id: "RGW-HELIOS",
    storage_endpoint_id: 11,
    storage_endpoint_name: "Default",
    storage_endpoint_url: "https://s3-default.docs.example.com",
    storage_endpoint_capabilities: {
      iam: true,
      sns: true,
      usage: true,
      metrics: true,
      static_website: true,
      sts: false,
    },
  },
];

const PORTAL_STATE = {
  account_id: 101,
  iam_user: {
    iam_user_id: "AIDAEXAMPLEPORTAL",
    iam_username: "portal-user-helios",
    arn: "arn:aws:iam::111111111111:user/portal-user-helios",
    created_at: NOW,
  },
  access_keys: [
    {
      access_key_id: "AKIAHELIOSPORTAL001",
      status: "Active",
      created_at: NOW,
      is_active: true,
      is_portal: true,
      deletable: false,
    },
  ],
  buckets: MANAGER_BUCKETS,
  total_buckets: MANAGER_BUCKETS.length,
  s3_endpoint: "https://s3-default.docs.example.com",
  used_bytes: 1_128_876_445,
  used_objects: 1_722,
  quota_max_size_bytes: 10 * 1024 * 1024 * 1024,
  quota_max_objects: 100_000,
  account_role: "portal_manager",
  can_manage_buckets: true,
  can_manage_portal_users: true,
};

const PORTAL_SETTINGS = {
  allow_portal_key: true,
  allow_portal_user_bucket_create: true,
  allow_portal_user_access_key_create: true,
  iam_group_manager_policy: { actions: ["s3:*"] },
  iam_group_user_policy: { actions: ["s3:GetObject", "s3:ListBucket"] },
  bucket_access_policy: { actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"] },
  bucket_defaults: {
    versioning: true,
    enable_cors: true,
    enable_lifecycle: true,
    cors_allowed_origins: ["https://app.example.com"],
  },
  override_policy: {
    allow_portal_key: true,
    allow_portal_user_bucket_create: true,
    allow_portal_user_access_key_create: true,
    iam_group_manager_policy: { actions: true, advanced_policy: true },
    iam_group_user_policy: { actions: true, advanced_policy: true },
    bucket_access_policy: { actions: true, advanced_policy: true },
    bucket_defaults: {
      versioning: true,
      enable_cors: true,
      enable_lifecycle: true,
      cors_allowed_origins: true,
    },
  },
};

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
    prefixes: ["2026/", "2025/"],
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

const PORTAL_TRAFFIC = {
  window: "week",
  start: "2026-03-01T00:00:00Z",
  end: NOW,
  resolution: "day",
  bucket_filter: null,
  data_points: 7,
  series: [
    { timestamp: "2026-03-02T00:00:00Z", bytes_in: 1200, bytes_out: 800, ops: 25, success_ops: 25 },
    { timestamp: "2026-03-03T00:00:00Z", bytes_in: 1800, bytes_out: 1200, ops: 41, success_ops: 40 },
    { timestamp: "2026-03-04T00:00:00Z", bytes_in: 2100, bytes_out: 1400, ops: 52, success_ops: 51 },
  ],
  totals: { bytes_in: 5100, bytes_out: 3400, ops: 118, success_ops: 116, success_rate: 0.983 },
  bucket_rankings: [
    { bucket: "helios-retail-logs", bytes_total: 6500, bytes_in: 3900, bytes_out: 2600, ops: 95, success_ops: 94, success_ratio: 0.989 },
  ],
  user_rankings: [
    { user: "portal-user-helios", bytes_total: 6500, bytes_in: 3900, bytes_out: 2600, ops: 95, success_ops: 94, success_ratio: 0.989 },
  ],
  request_breakdown: [{ group: "GetObject", bytes_in: 0, bytes_out: 2600, ops: 70 }],
  category_breakdown: [{ category: "read", bytes_in: 0, bytes_out: 2600, ops: 70 }],
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
          can_switch_access: true,
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
        total_portal_users: 3,
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
      id: "onboarding",
      path: /^\/admin\/onboarding$/,
      body: {
        dismissed: false,
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
      id: "portal-accounts",
      path: /^\/portal\/accounts$/,
      body: PORTAL_ACCOUNTS,
    },
    {
      id: "portal-state",
      path: /^\/portal\/state$/,
      body: PORTAL_STATE,
    },
    {
      id: "portal-usage",
      path: /^\/portal\/usage$/,
      body: {
        used_bytes: PORTAL_STATE.used_bytes,
        used_objects: PORTAL_STATE.used_objects,
      },
    },
    {
      id: "portal-traffic",
      path: /^\/portal\/traffic$/,
      body: PORTAL_TRAFFIC,
    },
    {
      id: "portal-users",
      path: /^\/portal\/users$/,
      body: [
        { id: 8, email: "storage.user@example.com", role: "ui_user", iam_username: "portal-user-helios", iam_only: false },
        { id: 9, email: "ops.admin@example.com", role: "ui_admin", iam_username: "portal-manager-helios", iam_only: false },
      ],
    },
    {
      id: "portal-key",
      path: /^\/portal\/access-keys\/portal$/,
      body: {
        access_key_id: "AKIAHELIOSPORTAL001",
        status: "Active",
        created_at: NOW,
        is_active: true,
        is_portal: true,
        deletable: false,
      },
    },
    {
      id: "portal-settings",
      path: /^\/portal\/settings$/,
      body: PORTAL_SETTINGS,
    },
    {
      id: "portal-endpoint-health",
      path: /^\/portal\/endpoint-health$/,
      body: WORKSPACE_HEALTH,
    },
    {
      id: "portal-bucket-stats",
      path: /^\/portal\/buckets\/[^/]+\/stats$/,
      body: ({ url }) => {
        const bucketName = parseBucketName(url.pathname);
        const bucket = MANAGER_BUCKETS.find((item) => item.name === bucketName);
        return {
          name: bucketName,
          used_bytes: bucket?.used_bytes ?? 0,
          object_count: bucket?.object_count ?? 0,
        };
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
        return {
          prefix: url.searchParams.get("prefix") ?? "",
          objects: value.objects,
          prefixes: value.prefixes,
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
      path: /^\/browser\/buckets\/[^/]+\/metadata$/,
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
      path: /^\/browser\/buckets\/[^/]+\/tags$/,
      body: {
        key: "daily/report-2026-03-08.json",
        tags: [
          { key: "env", value: "prod" },
          { key: "source", value: "docs" },
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

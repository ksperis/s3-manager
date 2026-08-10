import type { MockRule } from "../types";

const NOW = "2026-03-08T09:00:00Z";
const MB = 1024 ** 2;
const GB = 1024 ** 3;
const TB = 1024 ** 4;

const ADMIN_ACCOUNTS_MINIMAL = [
  {
    id: 101,
    name: "Helios Retail",
    tags: [{ id: 901, label: "prod", color_key: "emerald", scope: "standard" }],
    user_links: [
      { user_id: 1, role: "portal_manager", user_email: "admin.docs@example.com" },
      { user_id: 2, role: "portal_manager", user_email: "platform.admin@example.com" },
      { user_id: 3, role: "portal_user", user_email: "storage.user@example.com" },
    ],
    group_links: [],
    rgw_account_id: "RGW-HELIOS",
    storage_endpoint_id: 11,
    storage_endpoint_name: "Default",
    storage_endpoint_url: "https://s3-default.docs.example.com",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: { account: true, admin: true, usage: true },
    allow_bucket_quota_management: true,
  },
  {
    id: 102,
    name: "Northwind Ops",
    tags: [{ id: 902, label: "ops", color_key: "sky", scope: "standard" }],
    user_links: [{ user_id: 2, role: "account_administrator", user_email: "platform.admin@example.com" }],
    group_links: [],
    rgw_account_id: "RGW-NORTHWIND",
    storage_endpoint_id: 12,
    storage_endpoint_name: "Archive",
    storage_endpoint_url: "https://s3-archive.docs.example.com",
    storage_endpoint_is_default: false,
    storage_endpoint_capabilities: { account: true, admin: true, usage: true },
    allow_bucket_quota_management: false,
  },
];

const ADMIN_UI_USERS = [
  {
    id: 1,
    email: "admin.docs@example.com",
    role: "ui_superadmin",
    can_access_ceph_admin: true,
    can_access_storage_ops: true,
    manager_tool_access: {
      bucket_compare: true,
      bucket_integrity_check: true,
      bucket_migration: true,
      ceph_s3_user_keys: true,
    },
    accounts: [101],
    account_links: [{ account_id: 101, account_admin: true, account_role: "portal_manager" }],
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
    manager_tool_access: {
      bucket_compare: true,
      bucket_integrity_check: true,
      bucket_migration: true,
      ceph_s3_user_keys: true,
    },
    accounts: [101, 102],
    account_links: [
      { account_id: 101, account_admin: true, account_role: "portal_manager" },
      { account_id: 102, account_admin: true, account_role: "portal_none" },
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
    manager_tool_access: {
      bucket_compare: true,
      bucket_integrity_check: true,
      bucket_migration: true,
      ceph_s3_user_keys: true,
    },
    accounts: [101],
    account_links: [{ account_id: 101, account_admin: false, account_role: "portal_user" }],
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
      replication: true,
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
      replication: { enabled: true },
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
      replication: false,
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
      replication: { enabled: false },
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
  browser_portal_enabled: true,
  browser_ceph_admin_enabled: true,
  portal_enabled: true,
  billing_enabled: false,
  endpoint_status_enabled: true,
  bucket_migration_enabled: true,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  bucket_usage_stats_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: true,
  allow_login_custom_endpoint: false,
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
    max_buckets: 4,
    max_users: 5,
    max_roles: 6,
    max_groups: 4,
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
      replication: true,
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
      replication: false,
    },
    capabilities: {
      can_manage_iam: false,
      sts_capable: false,
      admin_api_capable: false,
    },
  },
];

const PORTAL_BROWSER_EXECUTION_CONTEXT = {
  kind: "portal_account",
  id: "101",
  display_name: "Helios Retail",
  account_role: "portal_user",
  manager_account_is_admin: false,
  rgw_account_id: "RGW-HELIOS",
  quota_max_size_gb: 20 * 1024,
  quota_max_objects: 45_000_000,
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
    replication: true,
  },
  capabilities: {
    can_manage_iam: false,
    sts_capable: false,
    admin_api_capable: false,
  },
};

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

const MANAGER_TOTAL_BYTES = MANAGER_BUCKETS.reduce((acc, item) => acc + (item.used_bytes ?? 0), 0);
const MANAGER_TOTAL_OBJECTS = MANAGER_BUCKETS.reduce((acc, item) => acc + (item.object_count ?? 0), 0);
const MANAGER_BUCKET_COUNT = MANAGER_BUCKETS.length;
const MANAGER_USAGE_STATS_AGGREGATE = {
  scope_kind: "manager_account",
  scope_id: "acc-helios",
  scope_name: "Helios Retail",
  bucket_count: MANAGER_BUCKET_COUNT,
  buckets_with_snapshot: MANAGER_BUCKET_COUNT,
  missing_bucket_count: 0,
  partial_scan_count: 0,
  object_version_count: MANAGER_TOTAL_OBJECTS + 340,
  current_version_count: MANAGER_TOTAL_OBJECTS,
  noncurrent_version_count: 340,
  delete_marker_count: 17,
  total_bytes: MANAGER_TOTAL_BYTES,
  current_bytes: Math.round(MANAGER_TOTAL_BYTES * 0.72),
  noncurrent_bytes: MANAGER_TOTAL_BYTES - Math.round(MANAGER_TOTAL_BYTES * 0.72),
  data_type_distribution: [
    { key: "logs", label: "Logs", count: 1_120, bytes: Math.round(MANAGER_TOTAL_BYTES * 0.42), ratio_count: 0.54, ratio_bytes: 0.42 },
    { key: "backup", label: "Backups", count: 760, bytes: Math.round(MANAGER_TOTAL_BYTES * 0.38), ratio_count: 0.37, ratio_bytes: 0.38 },
    { key: "json", label: "JSON", count: 182, bytes: MANAGER_TOTAL_BYTES - Math.round(MANAGER_TOTAL_BYTES * 0.42) - Math.round(MANAGER_TOTAL_BYTES * 0.38), ratio_count: 0.09, ratio_bytes: 0.20 },
  ],
  storage_class_distribution: [
    { key: "STANDARD", label: "STANDARD", count: 1_560, bytes: Math.round(MANAGER_TOTAL_BYTES * 0.74), ratio_count: 0.76, ratio_bytes: 0.74 },
    { key: "STANDARD_IA", label: "STANDARD_IA", count: 502, bytes: MANAGER_TOTAL_BYTES - Math.round(MANAGER_TOTAL_BYTES * 0.74), ratio_count: 0.24, ratio_bytes: 0.26 },
  ],
  size_distribution: [
    { key: "small", label: "< 1 MiB", count: 1_284, bytes: Math.round(MANAGER_TOTAL_BYTES * 0.18), ratio_count: 0.62, ratio_bytes: 0.18 },
    { key: "medium", label: "1-128 MiB", count: 646, bytes: Math.round(MANAGER_TOTAL_BYTES * 0.47), ratio_count: 0.31, ratio_bytes: 0.47 },
    { key: "large", label: "> 128 MiB", count: 132, bytes: MANAGER_TOTAL_BYTES - Math.round(MANAGER_TOTAL_BYTES * 0.18) - Math.round(MANAGER_TOTAL_BYTES * 0.47), ratio_count: 0.07, ratio_bytes: 0.35 },
  ],
  age_distribution: [
    { key: "recent", label: "< 7 days", count: 512, bytes: Math.round(MANAGER_TOTAL_BYTES * 0.22), ratio_count: 0.25, ratio_bytes: 0.22 },
    { key: "month", label: "7-30 days", count: 1_106, bytes: Math.round(MANAGER_TOTAL_BYTES * 0.51), ratio_count: 0.54, ratio_bytes: 0.51 },
    { key: "older", label: "> 30 days", count: 444, bytes: MANAGER_TOTAL_BYTES - Math.round(MANAGER_TOTAL_BYTES * 0.22) - Math.round(MANAGER_TOTAL_BYTES * 0.51), ratio_count: 0.21, ratio_bytes: 0.27 },
  ],
  current_vs_noncurrent: [
    { key: "current", label: "Current", count: MANAGER_TOTAL_OBJECTS, bytes: Math.round(MANAGER_TOTAL_BYTES * 0.72), ratio_count: 0.84, ratio_bytes: 0.72 },
    { key: "noncurrent", label: "Non-current", count: 340, bytes: MANAGER_TOTAL_BYTES - Math.round(MANAGER_TOTAL_BYTES * 0.72), ratio_count: 0.16, ratio_bytes: 0.28 },
  ],
  warnings: [],
  oldest_snapshot_at: "2026-03-08T08:45:00Z",
  newest_snapshot_at: NOW,
};

function managerTrafficPayload(window: string) {
  const seriesByWindow = {
    month: [
      { timestamp: "2026-02-08T00:00:00Z", bytes_in: Math.round(120 * GB), bytes_out: Math.round(100 * GB), ops: 420_000, success_ops: 418_000 },
      { timestamp: "2026-03-08T00:00:00Z", bytes_in: Math.round(180 * GB), bytes_out: Math.round(130 * GB), ops: 520_000, success_ops: 519_000 },
    ],
    week: [
      { timestamp: "2026-03-02T00:00:00Z", bytes_in: Math.round(42 * GB), bytes_out: Math.round(19 * GB), ops: 98_000, success_ops: 97_500 },
      { timestamp: "2026-03-08T00:00:00Z", bytes_in: Math.round(58 * GB), bytes_out: Math.round(22 * GB), ops: 120_000, success_ops: 119_000 },
    ],
    day: [
      { timestamp: "2026-03-08T06:00:00Z", bytes_in: Math.round(5 * GB), bytes_out: Math.round(2 * GB), ops: 12_000, success_ops: 11_980 },
      { timestamp: "2026-03-08T09:00:00Z", bytes_in: Math.round(6 * GB), bytes_out: Math.round(3 * GB), ops: 15_000, success_ops: 14_950 },
    ],
  } as const;
  const selected = seriesByWindow[(window in seriesByWindow ? window : "day") as keyof typeof seriesByWindow];
  const bytesIn = selected.reduce((acc, item) => acc + item.bytes_in, 0);
  const bytesOut = selected.reduce((acc, item) => acc + item.bytes_out, 0);
  const ops = selected.reduce((acc, item) => acc + item.ops, 0);
  const successOps = selected.reduce((acc, item) => acc + item.success_ops, 0);
  return {
    window,
    start: selected[0].timestamp,
    end: NOW,
    resolution: window === "day" ? "hour" : "daily",
    bucket_filter: null,
    data_points: selected.length,
    series: selected,
    totals: { bytes_in: bytesIn, bytes_out: bytesOut, ops, success_ops: successOps, success_rate: successOps / ops },
    bucket_rankings: [
      { bucket: "helios-retail-backups", bytes_total: Math.round(120 * GB), bytes_in: Math.round(72 * GB), bytes_out: Math.round(48 * GB), ops: 280_000, success_ops: 279_000, success_ratio: 0.996 },
      { bucket: "helios-retail-logs", bytes_total: Math.round(80 * GB), bytes_in: Math.round(46 * GB), bytes_out: Math.round(34 * GB), ops: 210_000, success_ops: 209_000, success_ratio: 0.995 },
    ],
    user_rankings: [
      { user: "helios-admin", bytes_total: bytesIn + bytesOut, bytes_in: bytesIn, bytes_out: bytesOut, ops, success_ops: successOps, success_ratio: successOps / ops },
    ],
    request_breakdown: [{ group: "GetObject", bytes_in: 0, bytes_out: bytesOut, ops: Math.round(ops * 0.55) }],
    category_breakdown: [{ category: "write", bytes_in: bytesIn, bytes_out: 0, ops: Math.round(ops * 0.45) }],
  };
}

const ADMIN_STORAGE_STATS = {
  total_accounts: ADMIN_ACCOUNTS_MINIMAL.length,
  total_users: ADMIN_UI_USERS.length,
  total_admins: 2,
  total_s3_users: 3,
  total_buckets: MANAGER_BUCKET_COUNT,
  generated_at: NOW,
  storage_totals: {
    used_bytes: MANAGER_TOTAL_BYTES,
    object_count: MANAGER_TOTAL_OBJECTS,
    bucket_count: MANAGER_BUCKET_COUNT,
    accounts_with_usage: 2,
  },
  account_usage: [
    {
      account_id: "101",
      account_name: "Helios Retail",
      used_bytes: MANAGER_TOTAL_BYTES,
      object_count: MANAGER_TOTAL_OBJECTS,
      bucket_count: MANAGER_BUCKET_COUNT,
    },
  ],
  s3_user_usage: [
    {
      user_id: 901,
      user_name: "helios-admin",
      rgw_user_uid: "helios-admin",
      used_bytes: Math.round(620 * GB),
      object_count: 4_200,
      bucket_count: 2,
    },
  ],
};

const ADMIN_AUDIT_LOGS = {
  logs: [
    {
      id: 1003,
      created_at: "2026-03-08T08:50:00Z",
      user_email: "platform.admin@example.com",
      user_role: "ui_admin",
      scope: "admin",
      action: "storage_endpoint.update",
      entity_type: "endpoint",
      entity_id: "Default",
      account_id: null,
      account_name: null,
      status: "success",
      message: "Endpoint health settings updated.",
      metadata: {},
    },
    {
      id: 1002,
      created_at: "2026-03-08T08:20:00Z",
      user_email: "admin.docs@example.com",
      user_role: "ui_superadmin",
      scope: "admin",
      action: "account.link_user",
      entity_type: "account",
      entity_id: "Helios Retail",
      account_id: 101,
      account_name: "Helios Retail",
      status: "success",
      message: "Portal manager linked.",
      metadata: {},
    },
    {
      id: 1001,
      created_at: "2026-03-08T07:55:00Z",
      user_email: "storage.user@example.com",
      user_role: "ui_user",
      scope: "browser",
      action: "bucket.list_objects",
      entity_type: "bucket",
      entity_id: "helios-retail-logs",
      account_id: 101,
      account_name: "Helios Retail",
      status: "success",
      message: "Objects listed.",
      metadata: {},
    },
  ],
  next_cursor: null,
};

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
    configuration: { "verify-ssl": "true" },
  },
  {
    name: "billing-alerts",
    arn: "arn:aws:sns:us-east-1:111111111111:billing-alerts",
    owner: "111111111111",
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
    id: 101,
    name: "Helios Retail",
    rgw_account_id: "RGW-HELIOS",
    account_role: "portal_manager",
    storage_endpoint_name: "Default",
    storage_endpoint_url: "https://s3-default.docs.example.com",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: {
      iam: true,
      sns: true,
      usage: true,
      metrics: true,
      static_website: true,
      sts: false,
      replication: true,
    },
  },
];

const PORTAL_STATE = {
  account_id: 101,
  iam_provisioned: true,
  iam_user: {
    iam_user_id: "AIDAEXAMPLEPORTAL",
    iam_username: "portal-user-helios",
    arn: "arn:aws:iam::111111111111:user/portal-user-helios",
    created_at: NOW,
  },
  access_keys: [
    {
      access_key_id: "AKIAHELIOSPORTALROOT",
      status: "Active",
      created_at: NOW,
      is_active: true,
      is_portal: true,
      deletable: false,
    },
    {
      access_key_id: "AKIAHELIOSPORTAL001",
      status: "Active",
      created_at: NOW,
      is_active: true,
      is_portal: false,
      deletable: true,
    },
  ],
  buckets: MANAGER_BUCKETS,
  total_buckets: MANAGER_BUCKETS.length,
  max_buckets: 12,
  s3_endpoint: "https://s3-default.docs.example.com",
  used_bytes: Math.round(8.32 * TB),
  used_objects: 17_100_000,
  quota_max_size_bytes: 20 * TB,
  quota_max_objects: 30_000_000,
  account_role: "portal_user",
  can_manage_buckets: true,
  can_create_private_storage_spaces: true,
  can_create_team_storage_spaces: false,
  allow_named_bucket_create: false,
  can_manage_access_keys: true,
  max_access_keys: 2,
  can_manage_portal_users: false,
};

const PORTAL_PROJECT_SETTINGS = {
  effective: {
    browser_access_enabled: true,
    allow_private_storage_space_create: true,
    allow_portal_named_bucket_create: false,
    allow_portal_user_access_key_create: true,
    server_access_logging_enabled: true,
    server_access_log_retention_days: 30,
    storage_space_version_cleanup_enabled: true,
    max_portal_user_access_keys: 2,
    bucket_defaults: {
      versioning: true,
      enable_lifecycle: true,
      noncurrent_version_expiration_days: 90,
      enable_cors: false,
      cors_allowed_origins: ["https://portal.docs.example.com"],
    },
  },
  project_override: {},
  delegated_to_portal_managers: false,
  can_update: false,
};

const PORTAL_ACCESS_KEYS_STATE = {
  iam_user: PORTAL_STATE.iam_user,
  s3_endpoint: PORTAL_STATE.s3_endpoint,
  can_manage_access_keys: PORTAL_STATE.can_manage_access_keys,
  max_access_keys: PORTAL_STATE.max_access_keys,
  access_keys: PORTAL_STATE.access_keys,
};

const PORTAL_COLLABORATORS = {
  summary: {
    collaborator_count: 4,
    external_access_key_count: 2,
    trend: {
      window: "month",
      label: "last 30 days",
      period_start: "2026-02-08",
      collaborator_count: 3,
    },
  },
  collaborators: [
    {
      user_id: 3,
      email: "storage.user@example.com",
      display_name: "Storage User",
      account_role: "portal_user",
      access_source: "direct",
      member_since: "2026-01-12T10:00:00Z",
    },
    {
      user_id: 4,
      email: "alice@example.com",
      display_name: "Alice Martin",
      account_role: "portal_user",
      access_source: "direct",
      member_since: "2026-01-20T10:00:00Z",
    },
    {
      user_id: 5,
      email: "bob@example.com",
      display_name: "Bob Dubois",
      account_role: "portal_user",
      access_source: "group",
      member_since: "2026-02-01T10:00:00Z",
    },
    {
      user_id: 6,
      email: "chen@example.com",
      display_name: "Chen Wei",
      account_role: "portal_manager",
      access_source: "direct_and_group",
      member_since: "2026-03-01T10:00:00Z",
    },
  ],
};

const PORTAL_TRAFFIC = {
  window: "day",
  start: "2026-03-08T00:00:00Z",
  end: NOW,
  resolution: "hour",
  bucket_filter: null,
  data_points: 5,
  series: [
    { timestamp: "2026-05-01T00:00:00Z", bytes_in: Math.round(540 * GB), bytes_out: Math.round(260 * GB), ops: 1_800_000, success_ops: 1_790_000 },
    { timestamp: "2026-05-07T00:00:00Z", bytes_in: Math.round(710 * GB), bytes_out: Math.round(340 * GB), ops: 2_100_000, success_ops: 2_080_000 },
    { timestamp: "2026-05-14T00:00:00Z", bytes_in: Math.round(880 * GB), bytes_out: Math.round(430 * GB), ops: 2_400_000, success_ops: 2_380_000 },
    { timestamp: "2026-05-21T00:00:00Z", bytes_in: Math.round(1.0 * TB), bytes_out: Math.round(520 * GB), ops: 2_800_000, success_ops: 2_780_000 },
    { timestamp: "2026-05-28T00:00:00Z", bytes_in: Math.round(1.1 * TB), bytes_out: Math.round(550 * GB), ops: 3_500_000, success_ops: 3_470_000 },
  ],
  totals: { bytes_in: Math.round(4.2 * TB), bytes_out: Math.round(2.1 * TB), ops: 12_600_000, success_ops: 12_500_000, success_rate: 0.992 },
  bucket_rankings: [
    { bucket: "genomics-2026", bytes_total: Math.round(3.0 * TB), bytes_in: Math.round(2.0 * TB), bytes_out: Math.round(1.0 * TB), ops: 7_200_000, success_ops: 7_160_000, success_ratio: 0.994 },
    { bucket: "photos", bytes_total: Math.round(2.1 * TB), bytes_in: Math.round(1.4 * TB), bytes_out: Math.round(700 * GB), ops: 3_400_000, success_ops: 3_360_000, success_ratio: 0.988 },
  ],
  user_rankings: [
    { user: "RGW-HELIOS", bytes_total: Math.round(6.3 * TB), bytes_in: Math.round(4.2 * TB), bytes_out: Math.round(2.1 * TB), ops: 12_600_000, success_ops: 12_500_000, success_ratio: 0.992 },
  ],
  request_breakdown: [{ group: "GetObject", bytes_in: 0, bytes_out: Math.round(2.1 * TB), ops: 8_400_000 }],
  category_breakdown: [{ category: "read", bytes_in: 0, bytes_out: Math.round(2.1 * TB), ops: 8_400_000 }],
};

const PORTAL_STORAGE_SPACES = [
  {
    id: "genomics-2026",
    name: "genomics-2026",
    role: "Owner",
    status: "Active",
    region: "eu-west-1",
    created_at: "2024-03-12T10:00:00Z",
    used_bytes: Math.round(3.42 * TB),
    object_count: 12_800_000,
    quota_max_size_bytes: 10 * TB,
    quota_max_objects: 30_000_000,
    internal_bucket_name: "rgw-portal-genomics-2026",
    description: "Genomics sequencing workspace",
  },
  {
    id: "photos",
    name: "photos",
    role: "Viewer",
    status: "Shared",
    region: "eu-west-3",
    created_at: "2023-05-10T10:00:00Z",
    used_bytes: Math.round(3.2 * TB),
    object_count: 2_800_000,
    quota_max_size_bytes: 8 * TB,
    quota_max_objects: 10_000_000,
    internal_bucket_name: "rgw-portal-photos",
    description: "Shared media storage",
  },
  {
    id: "datasets",
    name: "datasets",
    role: "Editor",
    status: "Active",
    region: "eu-west-1",
    created_at: "2023-03-16T10:00:00Z",
    used_bytes: Math.round(1.7 * TB),
    object_count: 1_500_000,
    quota_max_size_bytes: 5 * TB,
    quota_max_objects: 5_000_000,
    internal_bucket_name: "rgw-portal-datasets",
    description: "Curated analytics datasets",
  },
];

const PORTAL_BROWSER_BUCKETS = PORTAL_STORAGE_SPACES.map((space) => ({
  name: space.internal_bucket_name,
  creation_date: space.created_at,
  display_name: space.name,
  workspace_label: "Storage Space",
  used_bytes: space.used_bytes,
  object_count: space.object_count,
  quota_max_size_bytes: space.quota_max_size_bytes,
  quota_max_objects: space.quota_max_objects,
  status: space.status,
  role: space.role,
  internal_bucket_name: space.internal_bucket_name,
}));

const PORTAL_BROWSER_USAGE_SUMMARY = {
  available: true,
  source: "portal",
  label: "Storage Spaces",
  used_bytes: PORTAL_STORAGE_SPACES.reduce((acc, space) => acc + space.used_bytes, 0),
  object_count: PORTAL_STORAGE_SPACES.reduce((acc, space) => acc + space.object_count, 0),
  quota_max_size_bytes: PORTAL_STORAGE_SPACES.reduce((acc, space) => acc + space.quota_max_size_bytes, 0),
  quota_max_objects: PORTAL_STORAGE_SPACES.reduce((acc, space) => acc + space.quota_max_objects, 0),
};

const PORTAL_USAGE_STATS_AGGREGATE = {
  ...MANAGER_USAGE_STATS_AGGREGATE,
  scope_kind: "portal_account",
  scope_id: "101",
  scope_name: "Helios Retail",
  bucket_count: PORTAL_STORAGE_SPACES.length,
  buckets_with_snapshot: PORTAL_STORAGE_SPACES.length,
  total_bytes: PORTAL_STATE.used_bytes,
  current_bytes: Math.round(PORTAL_STATE.used_bytes * 0.84),
  noncurrent_bytes: PORTAL_STATE.used_bytes - Math.round(PORTAL_STATE.used_bytes * 0.84),
  object_version_count: PORTAL_STATE.used_objects + 120_000,
  current_version_count: PORTAL_STATE.used_objects,
  noncurrent_version_count: 120_000,
  delete_marker_count: 8,
  newest_snapshot_at: NOW,
};

const PORTAL_STORAGE_SPACE_USAGE_STATS = {
  snapshot: {
    scan_mode: "versions",
    version_listing_available: true,
    object_version_count: 12_920_000,
    current_version_count: 12_800_000,
    noncurrent_version_count: 120_000,
    delete_marker_count: 8,
    total_bytes: Math.round(3.42 * TB),
    current_bytes: Math.round(2.96 * TB),
    noncurrent_bytes: Math.round(0.46 * TB),
    data_type_distribution: MANAGER_USAGE_STATS_AGGREGATE.data_type_distribution,
    storage_class_distribution: MANAGER_USAGE_STATS_AGGREGATE.storage_class_distribution,
    size_distribution: MANAGER_USAGE_STATS_AGGREGATE.size_distribution,
    age_distribution: MANAGER_USAGE_STATS_AGGREGATE.age_distribution,
    current_vs_noncurrent: [
      { key: "current", label: "Current versions", count: 12_800_000, bytes: Math.round(2.96 * TB), ratio_count: 0.991, ratio_bytes: 0.865 },
      { key: "noncurrent", label: "Older versions", count: 120_000, bytes: Math.round(0.46 * TB), ratio_count: 0.009, ratio_bytes: 0.135 },
    ],
    calculated_at: NOW,
  },
};

const PORTAL_ACTIVITY = [
  {
    id: 1,
    created_at: NOW,
    actor: "Alice",
    action: "Created storage space",
    target: "genomics-2026",
    storage_space_id: "genomics-2026",
    storage_space_name: "genomics-2026",
    ip_address: "192.168.1.10",
    status: "success",
  },
  {
    id: 2,
    created_at: "2026-03-08T08:42:00Z",
    actor: "Bob",
    action: "Shared",
    target: "photos",
    storage_space_id: "photos",
    storage_space_name: "photos",
    ip_address: "192.168.1.23",
    status: "success",
  },
  {
    id: 3,
    created_at: "2026-03-08T08:15:00Z",
    actor: "Laurent",
    action: "Updated settings",
    target: "genomics-2026",
    storage_space_id: "genomics-2026",
    storage_space_name: "genomics-2026",
    ip_address: "192.168.1.10",
    status: "success",
  },
];

const PORTAL_ALERTS = [
  {
    id: "quota-genomics",
    tone: "warning",
    title: "Quota is getting close",
    description: "genomics-2026 is above one third of its allocated storage.",
    severity_label: "Warning",
    storage_space_id: "genomics-2026",
    created_at: NOW,
  },
  {
    id: "expiring-public-link",
    tone: "info",
    title: "Shared link expiring",
    description: "A review link expires in 2 days.",
    severity_label: "Info",
    storage_space_id: "photos",
    created_at: NOW,
  },
];

const PORTAL_REQUESTS = [
  {
    id: 701,
    account_id: 101,
    account_name: "Helios Retail",
    request_type: "portal_user_access",
    status: "pending",
    payload: {
      target_name: "Maya Chen",
      target_email: "maya.chen@example.org",
    },
    requester_user_id: 3,
    requester_email: "storage.user@example.com",
    decided_by_user_id: null,
    decided_by_email: null,
    decided_at: null,
    created_at: "2026-03-08T08:30:00Z",
    updated_at: "2026-03-08T08:30:00Z",
    messages: [],
  },
  {
    id: 702,
    account_id: 101,
    account_name: "Helios Retail",
    request_type: "account_quota_change",
    status: "approved",
    payload: {
      direction: "increase",
      target_quota_value: 25,
      target_quota_unit: "TiB",
      reason: "New analysis campaign",
    },
    requester_user_id: 3,
    requester_email: "storage.user@example.com",
    decided_by_user_id: 2,
    decided_by_email: "platform.admin@example.com",
    decided_at: "2026-03-08T09:00:00Z",
    created_at: "2026-03-07T15:15:00Z",
    updated_at: "2026-03-08T09:00:00Z",
    messages: [
      {
        id: 1,
        author_user_id: 2,
        author_email: "platform.admin@example.com",
        author_role: "admin",
        message: "Approved for the March campaign.",
        created_at: "2026-03-08T09:00:00Z",
      },
    ],
  },
  {
    id: 703,
    account_id: 101,
    account_name: "Helios Retail",
    request_type: "portal_user_removal",
    status: "pending",
    payload: {
      target_name: "Old Collaborator",
      target_email: "old.collaborator@example.org",
      reason: "The person left the project.",
    },
    requester_user_id: 3,
    requester_email: "storage.user@example.com",
    decided_by_user_id: null,
    decided_by_email: null,
    decided_at: null,
    created_at: "2026-03-08T09:15:00Z",
    updated_at: "2026-03-08T09:15:00Z",
    messages: [],
  },
];

const PORTAL_OBJECTS_BY_SPACE: Record<string, { prefixes: string[]; objects: Array<Record<string, unknown>> }> = {
  "genomics-2026": {
    prefixes: [
      "raw-data/",
      "raw-data/2024/",
      "raw-data/2024/03/",
      "raw-data/2024/03/01-fastq/",
      "raw-data/2024/03/02-aligned/",
      "raw-data/2024/03/03-variants/",
      "reports/",
    ],
    objects: [
      {
        key: "raw-data/2024/03/sample_001.fastq.gz",
        name: "sample_001.fastq.gz",
        size: Math.round(2.4 * GB),
        last_modified: "2024-03-12T10:15:43Z",
      },
      {
        key: "raw-data/2024/03/sample_002.fastq.gz",
        name: "sample_002.fastq.gz",
        size: Math.round(2.5 * GB),
        last_modified: "2024-03-12T10:17:00Z",
      },
      {
        key: "raw-data/2024/03/sample_003.fastq.gz",
        name: "sample_003.fastq.gz",
        size: Math.round(2.4 * GB),
        last_modified: "2024-03-12T10:18:00Z",
      },
      {
        key: "raw-data/2024/03/README.txt",
        name: "README.txt",
        size: Math.round(2.1 * 1024),
        last_modified: "2024-03-12T10:20:00Z",
      },
      {
        key: "reports/q1-summary.pdf",
        name: "q1-summary.pdf",
        size: Math.round(4.8 * MB),
        last_modified: "2024-03-15T09:00:00Z",
      },
    ],
  },
  photos: {
    prefixes: ["2024/", "shared/"],
    objects: [
      {
        key: "2024/image_001.jpg",
        name: "image_001.jpg",
        size: Math.round(4.2 * MB),
        last_modified: "2024-06-10T10:21:00Z",
      },
    ],
  },
  datasets: {
    prefixes: ["exports/"],
    objects: [
      {
        key: "exports/clinical-export.csv",
        name: "clinical-export.csv",
        size: 180 * MB,
        last_modified: NOW,
      },
    ],
  },
};

const PORTAL_BILLING_ME = {
  month: "2026-05",
  subject_type: "account",
  subject_id: 101,
  name: "Helios Retail",
  rgw_identifier: "RGW-HELIOS",
  daily: [
    { day: "2026-05-01", storage_bytes: Math.round(7.6 * TB), bytes_in: 340 * GB, bytes_out: 180 * GB, ops_total: 1_800_000 },
    { day: "2026-05-07", storage_bytes: Math.round(7.8 * TB), bytes_in: 390 * GB, bytes_out: 210 * GB, ops_total: 2_100_000 },
    { day: "2026-05-14", storage_bytes: Math.round(8.0 * TB), bytes_in: 420 * GB, bytes_out: 260 * GB, ops_total: 2_400_000 },
    { day: "2026-05-21", storage_bytes: Math.round(8.15 * TB), bytes_in: 510 * GB, bytes_out: 290 * GB, ops_total: 2_800_000 },
    { day: "2026-05-28", storage_bytes: Math.round(8.32 * TB), bytes_in: 640 * GB, bytes_out: 340 * GB, ops_total: 3_500_000 },
  ],
  usage: {
    bytes_in: Math.round(4.2 * TB),
    bytes_out: Math.round(2.1 * TB),
    ops_total: 12_600_000,
    ops_breakdown: { GetObject: 8_400_000, PutObject: 2_100_000, ListBucket: 2_100_000 },
  },
  storage: {
    avg_bytes: Math.round(8.1 * TB),
    avg_gb_month: 8_294,
    total_objects: 17_100_000,
  },
  coverage: {
    days_collected: 28,
    days_in_month: 31,
    coverage_ratio: 0.9,
  },
  cost: {
    currency: "EUR",
    storage_cost: 184.32,
    egress_cost: 42.18,
    ingress_cost: 0,
    requests_cost: 8.72,
    total_cost: 235.22,
    rate_card_name: "Docs QA baseline",
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

const HEALTH_OVERVIEW = {
  generated_at: NOW,
  window: "week",
  start: "2026-03-01T09:00:00Z",
  end: NOW,
  endpoints: [
    {
      endpoint_id: 11,
      name: "Default",
      endpoint_url: "https://s3-default.docs.example.com",
      status: "up",
      checked_at: NOW,
      latency_ms: 82,
      check_mode: "http",
      check_target_url: "https://s3-default.docs.example.com",
      availability_pct: 99.7,
      baseline_latency_ms: 80,
      timeline: [
        { timestamp: "2026-03-07T09:00:00Z", status: "up", latency_ms: 84 },
        { timestamp: NOW, status: "up", latency_ms: 82 },
      ],
    },
    {
      endpoint_id: 12,
      name: "Archive",
      endpoint_url: "https://s3-archive.docs.example.com",
      status: "degraded",
      checked_at: NOW,
      latency_ms: 390,
      check_mode: "http",
      check_target_url: "https://s3-archive.docs.example.com",
      availability_pct: 94.4,
      baseline_latency_ms: 210,
      timeline: [
        { timestamp: "2026-03-07T09:00:00Z", status: "up", latency_ms: 205 },
        { timestamp: NOW, status: "degraded", latency_ms: 390, reason: "High latency" },
      ],
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
  { name: "genomics-2026", creation_date: "2024-03-12T10:00:00Z" },
  { name: "photos", creation_date: "2023-05-10T10:00:00Z" },
  { name: "datasets", creation_date: "2023-03-16T10:00:00Z" },
  { name: "helios-retail-logs", creation_date: "2026-02-28T08:00:00Z" },
  { name: "helios-retail-backups", creation_date: "2026-02-27T12:00:00Z" },
  { name: "blueharbor-curated", creation_date: "2026-02-20T09:30:00Z" },
];

function isPortalBrowserRequest(url: URL): boolean {
  return url.searchParams.get("account_id") === "101";
}

function browserBucketMatchesSearch(
  bucket: {
    name: string;
    display_name?: string | null;
    workspace_label?: string | null;
    internal_bucket_name?: string | null;
  },
  search: string,
): boolean {
  if (!search) return true;
  const haystack = [
    bucket.name,
    bucket.display_name,
    bucket.workspace_label,
    bucket.internal_bucket_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search);
}

function browserBucketsForRequest(url: URL) {
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  return (isPortalBrowserRequest(url) ? PORTAL_BROWSER_BUCKETS : BROWSER_BUCKETS).filter((bucket) =>
    browserBucketMatchesSearch(bucket, search),
  );
}

function browserFixtureBucketName(bucketName: string): string {
  return PORTAL_STORAGE_SPACES.find((space) => space.internal_bucket_name === bucketName)?.id ?? bucketName;
}

const BROWSER_OBJECTS_BY_BUCKET: Record<string, { prefixes: string[]; objects: Array<Record<string, unknown>> }> = {
  "genomics-2026": {
    prefixes: [
      "raw-data/",
      "raw-data/2024/",
      "raw-data/2024/03/",
      "raw-data/2024/03/01-fastq/",
      "raw-data/2024/03/02-aligned/",
      "raw-data/2024/03/03-variants/",
      "reports/",
    ],
    objects: [
      {
        key: "raw-data/2024/03/sample_001.fastq.gz",
        size: Math.round(2.4 * GB),
        last_modified: "2024-03-12T10:15:43Z",
        etag: "\"portal-sample-001\"",
        storage_class: "STANDARD",
      },
      {
        key: "raw-data/2024/03/sample_002.fastq.gz",
        size: Math.round(2.5 * GB),
        last_modified: "2024-03-12T10:17:00Z",
        etag: "\"portal-sample-002\"",
        storage_class: "STANDARD",
      },
      {
        key: "raw-data/2024/03/README.txt",
        size: Math.round(2.1 * 1024),
        last_modified: "2024-03-12T10:20:00Z",
        etag: "\"portal-readme\"",
        storage_class: "STANDARD",
      },
      {
        key: "reports/q1-analysis.pdf",
        size: Math.round(28 * MB),
        last_modified: "2024-04-02T14:30:00Z",
        etag: "\"portal-report\"",
        storage_class: "STANDARD",
      },
    ],
  },
  photos: {
    prefixes: ["events/"],
    objects: [
      {
        key: "events/team-offsite.jpg",
        size: Math.round(8 * MB),
        last_modified: "2024-02-11T12:30:00Z",
        etag: "\"portal-photo\"",
        storage_class: "STANDARD",
      },
    ],
  },
  datasets: {
    prefixes: ["exports/"],
    objects: [
      {
        key: "exports/dataset.csv",
        size: Math.round(18 * MB),
        last_modified: "2024-01-18T09:00:00Z",
        etag: "\"portal-dataset\"",
        storage_class: "STANDARD",
      },
    ],
  },
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
      replication: true,
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

function parseStorageSpaceId(pathname: string): string {
  const match = pathname.match(/\/storage-spaces\/(.+?)(?:\/|$)/);
  return decodeURIComponent(match?.[1] ?? "genomics-2026");
}

function normalizePortalPrefix(value: string | null): string {
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
}

function listPortalObjectsForPrefix(
  value: { prefixes: string[]; objects: Array<Record<string, unknown>> },
  rawPrefix: string | null,
) {
  const prefix = normalizePortalPrefix(rawPrefix);
  if (!prefix) {
    return {
      prefixes: value.prefixes.filter((candidate) => !candidate.replace(/\/$/, "").includes("/")),
      objects: value.objects.filter((item) => {
        const key = typeof item.key === "string" ? item.key : "";
        return !key.includes("/");
      }),
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
      if (segment) childPrefixes.add(`${prefix}${segment}/`);
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
      id: "user-notifications",
      path: /^\/users\/me\/notifications$/,
      body: { items: [], unread_count: 0 },
    },
    {
      id: "execution-contexts",
      path: /^\/me\/execution-contexts$/,
      body: ({ url }) => {
        const workspace = url.searchParams.get("workspace") ?? "manager";
        if (workspace === "browser") {
          return [...EXECUTION_CONTEXTS, PORTAL_BROWSER_EXECUTION_CONTEXT];
        }
        return EXECUTION_CONTEXTS;
      },
    },
    {
      id: "workspace-access",
      path: /^\/me\/workspace-access$/,
      body: {
        admin: { available: false, context_count: 0 },
        ceph_admin: { available: false, context_count: 0 },
        storage_ops: { available: false, context_count: 0 },
        manager: { available: false, context_count: 0 },
        browser: { available: true, context_count: 1 },
        portal: { available: true, context_count: 1 },
        default_workspace: "portal",
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
      id: "admin-storage-stats",
      path: /^\/admin\/stats\/storage$/,
      body: ADMIN_STORAGE_STATS,
    },
    {
      id: "admin-traffic-stats",
      path: /^\/admin\/stats\/traffic$/,
      body: ({ url }) => managerTrafficPayload(url.searchParams.get("window") ?? "day"),
    },
    {
      id: "admin-audit-logs",
      path: /^\/admin\/audit\/logs$/,
      body: ADMIN_AUDIT_LOGS,
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
      id: "admin-portal-requests",
      path: /^\/admin\/portal-requests$/,
      body: PORTAL_REQUESTS,
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
      id: "health-overview",
      path: /^\/admin\/health\/overview$/,
      body: HEALTH_OVERVIEW,
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
        total_buckets: MANAGER_BUCKET_COUNT,
        total_iam_users: IAM_USERS.length,
        total_iam_groups: IAM_GROUPS.length,
        total_iam_roles: 2,
        total_iam_policies: IAM_POLICIES.length,
        total_bytes: MANAGER_TOTAL_BYTES,
        total_objects: MANAGER_TOTAL_OBJECTS,
        bucket_usage: MANAGER_BUCKETS.map((item) => ({ name: item.name, used_bytes: item.used_bytes, object_count: item.object_count })),
        bucket_overview: {
          bucket_count: MANAGER_BUCKET_COUNT,
          non_empty_buckets: MANAGER_BUCKET_COUNT,
          empty_buckets: 0,
          avg_bucket_size_bytes: 123456,
          avg_objects_per_bucket: 312,
          largest_bucket: { name: "helios-retail-backups", used_bytes: 902_122_001, object_count: 342 },
          most_objects_bucket: { name: "helios-retail-logs", used_bytes: 182_554_321, object_count: 1284 },
        },
      },
    },
    {
      id: "manager-usage-stats-aggregate",
      path: /^\/manager\/usage-stats\/latest$/,
      body: {
        aggregate: MANAGER_USAGE_STATS_AGGREGATE,
      },
    },
    {
      id: "manager-usage-trends",
      path: /^\/manager\/stats\/usage-trends$/,
      body: {
        storage: {
          window: "month",
          label: "last 30 days",
          period_start: "2026-02-08",
          used_bytes: Math.max(MANAGER_TOTAL_BYTES - 220 * MB, 0),
          used_objects: MANAGER_TOTAL_OBJECTS - 520,
          bucket_count: null,
          collected_at: "2026-02-08T09:00:00Z",
        },
        objects: {
          window: "month",
          label: "last 30 days",
          period_start: "2026-02-08",
          used_bytes: Math.max(MANAGER_TOTAL_BYTES - 220 * MB, 0),
          used_objects: MANAGER_TOTAL_OBJECTS - 520,
          bucket_count: null,
          collected_at: "2026-02-08T09:00:00Z",
        },
        buckets: {
          window: "month",
          label: "last 30 days",
          period_start: "2026-02-08",
          used_bytes: null,
          used_objects: null,
          bucket_count: Math.max(MANAGER_BUCKET_COUNT - 1, 0),
          collected_at: "2026-02-08T09:00:00Z",
        },
      },
    },
    {
      id: "manager-traffic",
      path: /^\/manager\/stats\/traffic$/,
      body: ({ url }) => managerTrafficPayload(url.searchParams.get("window") ?? "day"),
    },
    {
      id: "manager-health",
      path: /^\/manager\/stats\/endpoint-health$/,
      body: WORKSPACE_HEALTH,
    },
    {
      id: "manager-activity",
      path: /^\/manager\/activity$/,
      body: [
        {
          id: 101,
          created_at: "2026-03-08T08:55:00Z",
          action: "put_bucket_lifecycle",
          entity_type: "bucket",
          entity_id: "helios-retail-logs",
          account_id: 101,
          account_name: "Helios Retail",
          status: "success",
          user_email: "platform.admin@example.com",
        },
        {
          id: 102,
          created_at: "2026-03-08T08:35:00Z",
          action: "create_access_key",
          entity_type: "iam_user",
          entity_id: "backup-operator",
          account_id: 101,
          account_name: "Helios Retail",
          status: "success",
          user_email: "platform.admin@example.com",
        },
      ],
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
      id: "portal-eligibility",
      path: /^\/portal\/eligibility$/,
      body: {
        eligible: true,
        reasons: [],
      },
    },
    {
      id: "portal-state",
      path: /^\/portal\/state$/,
      body: PORTAL_STATE,
    },
    {
      id: "portal-project-settings",
      path: /^\/portal\/settings$/,
      body: PORTAL_PROJECT_SETTINGS,
    },
    {
      id: "portal-usage",
      path: /^\/portal\/usage$/,
      body: {
        used_bytes: PORTAL_STATE.used_bytes,
        used_objects: PORTAL_STATE.used_objects,
        quota_max_size_bytes: PORTAL_STATE.quota_max_size_bytes,
        quota_max_objects: PORTAL_STATE.quota_max_objects,
      },
    },
    {
      id: "portal-usage-trends",
      path: /^\/portal\/usage-trends$/,
      body: {
        storage: {
          window: "month",
          label: "last 30 days",
          period_start: "2026-02-08",
          used_bytes: Math.max(PORTAL_STATE.used_bytes - 180 * GB, 0),
          used_objects: PORTAL_STATE.used_objects - 420_000,
          bucket_count: null,
          collected_at: "2026-02-08T09:00:00Z",
        },
        objects: {
          window: "month",
          label: "last 30 days",
          period_start: "2026-02-08",
          used_bytes: Math.max(PORTAL_STATE.used_bytes - 180 * GB, 0),
          used_objects: PORTAL_STATE.used_objects - 420_000,
          bucket_count: null,
          collected_at: "2026-02-08T09:00:00Z",
        },
        buckets: {
          window: "month",
          label: "last 30 days",
          period_start: "2026-02-08",
          used_bytes: null,
          used_objects: null,
          bucket_count: Math.max(PORTAL_STORAGE_SPACES.length - 1, 0),
          collected_at: "2026-02-08T09:00:00Z",
        },
      },
    },
    {
      id: "portal-usage-stats-aggregate",
      path: /^\/portal\/usage-stats\/latest$/,
      body: {
        aggregate: PORTAL_USAGE_STATS_AGGREGATE,
      },
    },
    {
      id: "portal-storage-space-usage-stats",
      path: /^\/portal\/storage-spaces\/[^/]+\/usage-stats$/,
      body: PORTAL_STORAGE_SPACE_USAGE_STATS,
    },
    {
      id: "portal-access-keys",
      path: /^\/portal\/access-keys$/,
      body: PORTAL_ACCESS_KEYS_STATE,
    },
    {
      id: "portal-collaborators",
      path: /^\/portal\/collaborators$/,
      body: PORTAL_COLLABORATORS,
    },
    {
      id: "portal-requests",
      path: /^\/portal\/requests$/,
      body: PORTAL_REQUESTS,
    },
    {
      id: "portal-endpoint-health",
      path: /^\/portal\/endpoint-health$/,
      body: WORKSPACE_HEALTH,
    },
    {
      id: "portal-traffic",
      path: /^\/portal\/traffic$/,
      body: ({ url }) => {
        const window = url.searchParams.get("window") ?? PORTAL_TRAFFIC.window;
        const bucket = url.searchParams.get("bucket");
        if (!bucket) return { ...PORTAL_TRAFFIC, window };
        const ranking = PORTAL_TRAFFIC.bucket_rankings[0];
        return {
          ...PORTAL_TRAFFIC,
          window,
          bucket_filter: bucket,
          series: [
            {
              timestamp: PORTAL_TRAFFIC.end,
              bytes_in: ranking.bytes_in,
              bytes_out: ranking.bytes_out,
              ops: ranking.ops,
              success_ops: ranking.success_ops,
            },
          ],
          totals: {
            bytes_in: ranking.bytes_in,
            bytes_out: ranking.bytes_out,
            ops: ranking.ops,
            success_ops: ranking.success_ops,
            success_rate: ranking.success_ratio,
          },
          bucket_rankings: [{ ...ranking, bucket }],
        };
      },
    },
    {
      id: "portal-storage-spaces",
      path: /^\/portal\/storage-spaces$/,
      body: ({ url }) => {
        const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
        if (!search) return PORTAL_STORAGE_SPACES;
        return PORTAL_STORAGE_SPACES.filter((space) => space.name.toLowerCase().includes(search));
      },
    },
    {
      id: "portal-storage-space-detail",
      path: /^\/portal\/storage-spaces\/[^/]+$/,
      body: ({ url }) => {
        const spaceId = parseStorageSpaceId(url.pathname);
        return PORTAL_STORAGE_SPACES.find((space) => space.id === spaceId) ?? PORTAL_STORAGE_SPACES[0];
      },
    },
    {
      id: "portal-storage-space-settings",
      path: /^\/portal\/storage-spaces\/[^/]+\/settings$/,
      body: {
        versioning_enabled: true,
        versioning_status: "Enabled",
        lifecycle_enabled: true,
        version_history_retention_days: 90,
        can_update: false,
      },
    },
    {
      id: "portal-storage-space-access-summary",
      path: /^\/portal\/storage-spaces\/[^/]+\/access-summary$/,
      body: ({ url }) => {
        const spaceId = parseStorageSpaceId(url.pathname);
        const space = PORTAL_STORAGE_SPACES.find((item) => item.id === spaceId) ?? PORTAL_STORAGE_SPACES[0];
        const isOwner = space.role === "Owner";
        return {
          mode: isOwner ? "restricted" : "private",
          default_account_member_role: null,
          owner: {
            user_id: 3,
            email: "storage.user@example.com",
            display_name: "Storage User",
            role: "Owner",
            account_role: "portal_user",
            access_source: "owner",
          },
          effective_member_count: isOwner ? 3 : 1,
          explicit_shares: isOwner
            ? [
                {
                  id: `share-${space.id}-alice`,
                  storage_space_id: space.id,
                  storage_space_name: space.name,
                  user_id: 4,
                  email: "alice@example.com",
                  role: "Editor",
                  direction: "by_me",
                  activity_label: "2h ago",
                },
                {
                  id: `share-${space.id}-bob`,
                  storage_space_id: space.id,
                  storage_space_name: space.name,
                  user_id: 5,
                  email: "bob@example.com",
                  role: "Viewer",
                  direction: "by_me",
                  activity_label: "1d ago",
                },
              ]
            : [],
          public_link_count: isOwner ? 1 : 0,
          can_manage_access: isOwner,
          can_create_public_links: isOwner,
        };
      },
    },
    {
      id: "portal-share-candidates",
      path: /^\/portal\/share-candidates$/,
      body: [
        {
          user_id: 4,
          email: "alice@example.com",
          display_name: "Alice Martin",
          account_role: "portal_user",
          access_source: "direct",
          already_shared: false,
        },
        {
          user_id: 5,
          email: "bob@example.com",
          display_name: "Bob Dubois",
          account_role: "portal_user",
          access_source: "group",
          already_shared: false,
        },
        {
          user_id: 6,
          email: "chen@example.com",
          display_name: "Chen Wei",
          account_role: "portal_user",
          access_source: "direct_and_group",
          already_shared: false,
        },
      ],
    },
    {
      id: "portal-storage-space-share-candidates",
      path: /^\/portal\/storage-spaces\/[^/]+\/share-candidates$/,
      body: ({ url }) => {
        const spaceId = parseStorageSpaceId(url.pathname);
        const space = PORTAL_STORAGE_SPACES.find((item) => item.id === spaceId) ?? PORTAL_STORAGE_SPACES[0];
        const isOwner = space.role === "Owner";
        return [
          {
            user_id: 4,
            email: "alice@example.com",
            display_name: "Alice Martin",
            account_role: "portal_user",
            access_source: "direct",
            already_shared: isOwner,
          },
          {
            user_id: 5,
            email: "bob@example.com",
            display_name: "Bob Dubois",
            account_role: "portal_user",
            access_source: "group",
            already_shared: isOwner,
          },
          {
            user_id: 6,
            email: "chen@example.com",
            display_name: "Chen Wei",
            account_role: "portal_user",
            access_source: "direct_and_group",
            already_shared: false,
          },
        ];
      },
    },
    {
      id: "portal-storage-space-objects",
      path: /^\/portal\/storage-spaces\/[^/]+\/objects$/,
      body: ({ url }) => {
        const spaceId = parseStorageSpaceId(url.pathname);
        const value = PORTAL_OBJECTS_BY_SPACE[spaceId] ?? PORTAL_OBJECTS_BY_SPACE["genomics-2026"];
        const filtered = listPortalObjectsForPrefix(value, url.searchParams.get("prefix"));
        return {
          prefix: normalizePortalPrefix(url.searchParams.get("prefix")),
          objects: filtered.objects,
          prefixes: filtered.prefixes,
          is_truncated: false,
          next_continuation_token: null,
        };
      },
    },
    {
      id: "portal-storage-space-object-detail",
      path: /^\/portal\/storage-spaces\/[^/]+\/objects\/detail$/,
      body: ({ url }) => {
        const key = url.searchParams.get("key") ?? "raw-data/2024/03/sample_001.fastq.gz";
        const spaceId = parseStorageSpaceId(url.pathname);
        const value = PORTAL_OBJECTS_BY_SPACE[spaceId] ?? PORTAL_OBJECTS_BY_SPACE["genomics-2026"];
        const object = value.objects.find((item) => item.key === key) ?? value.objects[0];
        return {
          key,
          name: object?.name ?? key.split("/").pop() ?? key,
          size: object?.size ?? Math.round(2.4 * GB),
          last_modified: object?.last_modified ?? "2024-03-12T10:15:43Z",
          content_type: key.endsWith(".txt") ? "text/plain" : "application/gzip",
          storage_class: "STANDARD",
          encryption: "AES256",
          preview_type: key.endsWith(".txt") ? "text" : "unavailable",
          preview_text: key.endsWith(".txt") ? "README for the selected storage space." : null,
          preview_unavailable_reason: key.endsWith(".txt") ? null : "Preview is available only for small text files.",
        };
      },
    },
    {
      id: "portal-storage-space-public-links",
      path: /^\/portal\/storage-spaces\/[^/]+\/public-links$/,
      body: ({ url }) => {
        const spaceId = parseStorageSpaceId(url.pathname);
        const space = PORTAL_STORAGE_SPACES.find((item) => item.id === spaceId) ?? PORTAL_STORAGE_SPACES[0];
        return [
          {
            id: 42,
            storage_space_id: space.id,
            storage_space_name: space.name,
            object_key: "raw-data/2024/03/sample_001.fastq.gz",
            object_name: "sample_001.fastq.gz",
            url: "/api/portal/public-links/docs-token/download",
            label: "Review link",
            created_by_email: "storage.user@example.com",
            created_at: NOW,
            expires_at: "2026-06-10T10:00:00Z",
            revoked_at: null,
            status: "Active",
          },
        ];
      },
    },
    {
      id: "portal-storage-space-shares",
      path: /^\/portal\/storage-spaces\/[^/]+\/shares$/,
      body: ({ url }) => {
        const spaceId = parseStorageSpaceId(url.pathname);
        const space = PORTAL_STORAGE_SPACES.find((item) => item.id === spaceId) ?? PORTAL_STORAGE_SPACES[0];
        return [
          {
            id: `share-${space.id}-alice`,
            storage_space_id: space.id,
            storage_space_name: space.name,
            user_id: 3,
            email: "alice@example.com",
            role: "Editor",
            direction: "by_me",
            activity_label: "2h ago",
          },
          {
            id: `share-${space.id}-bob`,
            storage_space_id: space.id,
            storage_space_name: space.name,
            user_id: 4,
            email: "bob@example.com",
            role: "Viewer",
            direction: "with_me",
            activity_label: "1d ago",
          },
        ];
      },
    },
    {
      id: "portal-activity",
      path: /^\/portal\/activity$/,
      body: PORTAL_ACTIVITY,
    },
    {
      id: "portal-alerts",
      path: /^\/portal\/alerts$/,
      body: PORTAL_ALERTS,
    },
    {
      id: "portal-billing-me",
      path: /^\/portal\/billing\/me$/,
      body: ({ url }) => ({
        ...PORTAL_BILLING_ME,
        month: url.searchParams.get("month") ?? PORTAL_BILLING_ME.month,
      }),
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
      body: ({ url }) => browserBucketsForRequest(url),
    },
    {
      id: "browser-buckets-search",
      path: /^\/browser\/buckets\/search$/,
      body: ({ url }) => {
        const buckets = browserBucketsForRequest(url);
        return {
          items: buckets,
          total: buckets.length,
          page: 1,
          page_size: 50,
          has_next: false,
        };
      },
    },
    {
      id: "browser-usage-summary",
      path: /^\/browser\/usage-summary$/,
      body: ({ url }) => {
        if (isPortalBrowserRequest(url)) return PORTAL_BROWSER_USAGE_SUMMARY;
        return {
          available: false,
          source: "account",
          label: "Account",
        };
      },
    },
    {
      id: "browser-list-objects",
      path: /^\/browser\/buckets\/[^/]+\/objects$/,
      body: ({ url }) => {
        const bucketName = browserFixtureBucketName(parseBucketName(url.pathname));
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

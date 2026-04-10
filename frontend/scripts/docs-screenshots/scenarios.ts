import { buildBaseRules } from "./fixtures/base";
import type { DocScreenshotScenario, MockRule } from "./types";

const superAdminUser = {
  id: 1,
  email: "admin.docs@example.com",
  role: "ui_superadmin",
  ui_language: "en",
  can_access_ceph_admin: true,
  authType: "password",
  account_links: [
    { account_id: 101, account_admin: true },
  ],
  s3_user_details: [{ id: 901, name: "helios-admin" }],
  s3_connection_details: [{ id: 701, name: "BlueHarbor Shared Connection", access_manager: true, access_browser: true }],
  capabilities: { can_manage_buckets: true, can_manage_iam: true, access_browser: true },
};

const adminUser = {
  id: 2,
  email: "platform.admin@example.com",
  role: "ui_admin",
  ui_language: "en",
  can_access_ceph_admin: true,
  authType: "password",
  account_links: [
    { account_id: 101, account_admin: true },
  ],
  s3_user_details: [{ id: 903, name: "platform-admin" }],
  s3_connection_details: [{ id: 701, name: "BlueHarbor Shared Connection", access_manager: true, access_browser: true }],
  capabilities: { can_manage_buckets: true, can_manage_iam: true, access_browser: true },
};

const storageOpsAdminUser = {
  ...adminUser,
  can_access_storage_ops: true,
};

const storageUser = {
  id: 3,
  email: "storage.user@example.com",
  role: "ui_user",
  ui_language: "en",
  can_access_ceph_admin: false,
  authType: "password",
  account_links: [
    { account_id: 101, account_admin: false },
  ],
  s3_user_details: [{ id: 904, name: "storage-user-helios" }],
  s3_connection_details: [{ id: 701, name: "BlueHarbor Shared Connection", access_manager: true, access_browser: true }],
  capabilities: { can_manage_buckets: true, can_manage_iam: true, access_browser: true },
};

function baseStorage(user: Record<string, unknown>) {
  return {
    token: "docs-token",
    user,
    selectedWorkspace: "admin" as const,
    selectedExecutionContextId: "acc-helios",
    selectedCephAdminEndpointId: "11",
  };
}

function withBaseRules(...extraRules: MockRule[]): MockRule[] {
  return [...extraRules, ...buildBaseRules()];
}

const BROWSER_ROOT_UI_STATE_STORAGE_KEY = "browser:root-ui-state:v1";
const BROWSER_FOCUSED_BUCKET = "helios-retail-logs";
const BROWSER_FOCUSED_PREFIX = "daily/";
const BROWSER_FOCUSED_OBJECT_KEY = "daily/report-2026-03-08.json";

function buildBrowserRootUiStateEntry(layout: {
  showFolders: boolean;
  showInspector: boolean;
  showActionBar: boolean;
}) {
  return JSON.stringify({
    layout,
    contextSelections: {
      "acc-helios": {
        bucketName: BROWSER_FOCUSED_BUCKET,
        prefix: BROWSER_FOCUSED_PREFIX,
      },
    },
  });
}

const browserAllPanelsStateEntry = buildBrowserRootUiStateEntry({
  showFolders: true,
  showInspector: true,
  showActionBar: true,
});

const browserVersioningEnabledRule: MockRule = {
  id: "browser-versioning-enabled",
  path: /^\/browser\/buckets\/[^/]+\/versioning$/,
  body: {
    status: "Enabled",
    enabled: true,
  },
};

const browserObjectVersionsRule: MockRule = {
  id: "browser-object-versions-with-history",
  path: /^\/browser\/buckets\/[^/]+\/versions$/,
  body: ({ url }) => {
    const key = url.searchParams.get("key") ?? "";
    if (key !== BROWSER_FOCUSED_OBJECT_KEY) {
      return {
        prefix: url.searchParams.get("prefix") ?? "",
        versions: [],
        delete_markers: [],
        is_truncated: false,
      };
    }
    return {
      prefix: BROWSER_FOCUSED_PREFIX,
      versions: [
        {
          key,
          version_id: "v-2026-03-08-0900",
          is_latest: true,
          is_delete_marker: false,
          last_modified: "2026-03-08T09:00:00Z",
          size: 84251,
          etag: "\"3d4f1a\"",
          storage_class: "STANDARD",
        },
        {
          key,
          version_id: "v-2026-03-08-0715",
          is_latest: false,
          is_delete_marker: false,
          last_modified: "2026-03-08T07:15:00Z",
          size: 83890,
          etag: "\"1c0af9\"",
          storage_class: "STANDARD",
        },
      ],
      delete_markers: [
        {
          key,
          version_id: "m-2026-03-07-2210",
          is_latest: false,
          is_delete_marker: true,
          last_modified: "2026-03-07T22:10:00Z",
          size: null,
          etag: null,
          storage_class: "STANDARD",
        },
      ],
      is_truncated: false,
    };
  },
};

const browserDelayedDeleteRule: MockRule = {
  id: "browser-delete-with-progress",
  method: "POST",
  path: /^\/browser\/buckets\/[^/]+\/delete$/,
  delayMs: 800,
  body: ({ requestBodyText }) => {
    let payload: { objects?: Array<{ key?: string }> } = {};
    try {
      payload = JSON.parse(requestBodyText || "{}") as {
        objects?: Array<{ key?: string }>;
      };
    } catch {
      payload = {};
    }
    return {
      deleted: payload.objects?.length ?? 0,
    };
  },
};

const noManagerContextsRule: MockRule = {
  id: "no-manager-contexts",
  path: /^\/me\/execution-contexts$/,
  body: ({ url }) => {
    const workspace = url.searchParams.get("workspace") ?? "manager";
    if (workspace === "manager") return [];
    return [
      {
        kind: "account",
        id: "acc-helios",
        display_name: "Helios Retail",
        manager_account_is_admin: true,
        endpoint_id: 11,
        endpoint_name: "Default",
        endpoint_provider: "ceph",
        endpoint_url: "https://s3-default.docs.example.com",
        storage_endpoint_capabilities: { iam: true, sns: true, usage: true, metrics: true, static_website: true, sts: false },
        capabilities: { can_manage_iam: true, sts_capable: false, admin_api_capable: true },
      },
    ];
  },
};

const bucketCompareWithDifferencesRule: MockRule = {
  id: "manager-bucket-compare-with-differences",
  method: "POST",
  path: /^\/manager\/buckets\/compare$/,
  body: ({ requestBodyText }) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(requestBodyText || "{}") as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const sourceBucket = String(payload.source_bucket ?? "helios-retail-logs");
    const targetBucket = String(payload.target_bucket ?? "blueharbor-curated");
    return {
      source_context_id: "acc-helios",
      target_context_id: String(payload.target_context_id ?? "conn-blueharbor"),
      source_bucket: sourceBucket,
      target_bucket: targetBucket,
      compare_mode: "md5_or_size",
      has_differences: true,
      content_diff: {
        compare_mode: "md5_or_size",
        source_count: 1284,
        target_count: 1278,
        matched_count: 1272,
        different_count: 4,
        only_source_count: 6,
        only_target_count: 2,
        only_source_sample: ["daily/2026-03-07/report.json", "logs/part-0081.gz"],
        only_target_sample: ["daily/2026-03-06/report.json"],
        different_sample: [
          {
            key: "daily/2026-03-08/report.json",
            source_size: 84251,
            target_size: 84912,
            source_etag: "\"3d4f1a\"",
            target_etag: "\"44af18\"",
            compare_by: "md5",
          },
        ],
      },
      config_diff: {
        changed: true,
        sections: [
          {
            key: "versioning_status",
            label: "Versioning",
            source: "Enabled",
            target: "Suspended",
            changed: true,
          },
        ],
      },
    };
  },
};

const storageOpsEnabledGeneralSettingsRule: MockRule = {
  id: "settings-general-storage-ops-enabled",
  path: /^\/settings\/general$/,
  body: {
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
    storage_ops_enabled: true,
    allow_ui_user_bucket_migration: true,
    allow_login_access_keys: false,
    allow_login_endpoint_list: true,
    allow_login_custom_endpoint: false,
    allow_user_private_connections: true,
  },
};

const billingEnabledGeneralSettingsRule: MockRule = {
  id: "settings-general-billing-enabled",
  path: /^\/settings\/general$/,
  body: {
    manager_enabled: true,
    ceph_admin_enabled: true,
    browser_enabled: true,
    browser_root_enabled: true,
    browser_manager_enabled: true,
    browser_ceph_admin_enabled: true,
    billing_enabled: true,
    endpoint_status_enabled: true,
    bucket_migration_enabled: true,
    bucket_compare_enabled: true,
    allow_ui_user_bucket_migration: true,
    allow_login_access_keys: false,
    allow_login_endpoint_list: true,
    allow_login_custom_endpoint: false,
    allow_user_private_connections: true,
  },
};

const endpointStatusLatencyOverviewRule: MockRule = {
  id: "admin-endpoint-status-latency-overview",
  path: /^\/admin\/health\/latency-overview$/,
  body: ({ url }) => ({
    generated_at: "2026-03-08T09:00:00Z",
    window: url.searchParams.get("window") ?? "day",
    start: "2026-03-07T09:00:00Z",
    end: "2026-03-08T09:00:00Z",
    endpoints: [
      {
        endpoint_id: 11,
        name: "Default",
        endpoint_url: "https://s3-default.docs.example.com",
        status: "up",
        checked_at: "2026-03-08T09:00:00Z",
        latency_ms: 82,
        check_mode: "http",
        check_target_url: "https://s3-default.docs.example.com/health",
        min_latency_ms: 71,
        avg_latency_ms: 79,
        max_latency_ms: 96,
        sample_count: 24,
      },
      {
        endpoint_id: 12,
        name: "Archive",
        endpoint_url: "https://s3-archive.docs.example.com",
        status: "degraded",
        checked_at: "2026-03-08T09:00:00Z",
        latency_ms: 390,
        check_mode: "http",
        check_target_url: "https://s3-archive.docs.example.com/health",
        min_latency_ms: 280,
        avg_latency_ms: 356,
        max_latency_ms: 420,
        sample_count: 24,
      },
    ],
  }),
};

const endpointStatusOverviewRule: MockRule = {
  id: "admin-endpoint-status-overview",
  path: /^\/admin\/health\/overview$/,
  body: ({ url }) => ({
    generated_at: "2026-03-08T09:00:00Z",
    window: url.searchParams.get("window") ?? "week",
    start: "2026-03-01T00:00:00Z",
    end: "2026-03-08T09:00:00Z",
    endpoints: [
      {
        endpoint_id: 11,
        name: "Default",
        endpoint_url: "https://s3-default.docs.example.com",
        status: "up",
        checked_at: "2026-03-08T09:00:00Z",
        latency_ms: 82,
        check_mode: "http",
        check_target_url: "https://s3-default.docs.example.com/health",
        availability_pct: 99.8,
        baseline_latency_ms: 78,
        timeline: [
          { timestamp: "2026-03-01T00:00:00Z", end_timestamp: "2026-03-02T00:00:00Z", status: "up", latency_ms: 77 },
          { timestamp: "2026-03-02T00:00:00Z", end_timestamp: "2026-03-03T00:00:00Z", status: "up", latency_ms: 79 },
          { timestamp: "2026-03-03T00:00:00Z", end_timestamp: "2026-03-04T00:00:00Z", status: "up", latency_ms: 75 },
          { timestamp: "2026-03-04T00:00:00Z", end_timestamp: "2026-03-05T00:00:00Z", status: "up", latency_ms: 81 },
          { timestamp: "2026-03-05T00:00:00Z", end_timestamp: "2026-03-06T00:00:00Z", status: "up", latency_ms: 84 },
          { timestamp: "2026-03-06T00:00:00Z", end_timestamp: "2026-03-07T00:00:00Z", status: "up", latency_ms: 80 },
          { timestamp: "2026-03-07T00:00:00Z", end_timestamp: "2026-03-08T09:00:00Z", status: "up", latency_ms: 82 },
        ],
      },
      {
        endpoint_id: 12,
        name: "Archive",
        endpoint_url: "https://s3-archive.docs.example.com",
        status: "degraded",
        checked_at: "2026-03-08T09:00:00Z",
        latency_ms: 390,
        check_mode: "http",
        check_target_url: "https://s3-archive.docs.example.com/health",
        availability_pct: 94.1,
        baseline_latency_ms: 310,
        timeline: [
          { timestamp: "2026-03-01T00:00:00Z", end_timestamp: "2026-03-02T00:00:00Z", status: "up", latency_ms: 305 },
          { timestamp: "2026-03-02T00:00:00Z", end_timestamp: "2026-03-03T00:00:00Z", status: "up", latency_ms: 298 },
          { timestamp: "2026-03-03T00:00:00Z", end_timestamp: "2026-03-04T00:00:00Z", status: "degraded", latency_ms: 352, reason: "Latency spike" },
          { timestamp: "2026-03-04T00:00:00Z", end_timestamp: "2026-03-05T00:00:00Z", status: "up", latency_ms: 312 },
          { timestamp: "2026-03-05T00:00:00Z", end_timestamp: "2026-03-06T00:00:00Z", status: "down", latency_ms: null, reason: "Gateway timeout" },
          { timestamp: "2026-03-06T00:00:00Z", end_timestamp: "2026-03-07T00:00:00Z", status: "up", latency_ms: 301 },
          { timestamp: "2026-03-07T00:00:00Z", end_timestamp: "2026-03-08T09:00:00Z", status: "degraded", latency_ms: 390, reason: "High latency" },
        ],
      },
    ],
  }),
};

const endpointStatusGlobalIncidentsRule: MockRule = {
  id: "admin-endpoint-status-incidents-global",
  path: /^\/admin\/health\/incidents-global$/,
  body: ({ url }) => ({
    window: url.searchParams.get("window") ?? "half_year",
    start: "2025-09-08T00:00:00Z",
    end: "2026-03-08T09:00:00Z",
    total: 2,
    incidents: [
      {
        endpoint_id: 12,
        endpoint_name: "Archive",
        endpoint_url: "https://s3-archive.docs.example.com",
        status: "degraded",
        start: "2026-03-08T08:42:00Z",
        end: null,
        duration_minutes: 18,
        check_mode: "http",
      },
      {
        endpoint_id: 12,
        endpoint_name: "Archive",
        endpoint_url: "https://s3-archive.docs.example.com",
        status: "down",
        start: "2026-03-05T10:00:00Z",
        end: "2026-03-05T11:30:00Z",
        duration_minutes: 90,
        check_mode: "http",
      },
    ],
  }),
};

const billingSummaryRule: MockRule = {
  id: "admin-billing-summary",
  path: /^\/admin\/billing\/summary$/,
  body: {
    month: "2026-03",
    storage_endpoint_id: 11,
    usage: {
      bytes_in: 912_000_000,
      bytes_out: 3_420_000_000,
      ops_total: 18_450_000,
    },
    storage: {
      avg_bytes: 2_950_000_000,
      avg_gb_month: 91.4,
      total_objects: 1_540_000,
    },
    coverage: {
      days_collected: 27,
      days_in_month: 31,
      coverage_ratio: 27 / 31,
    },
    cost: {
      currency: "EUR",
      storage_cost: 92.5,
      egress_cost: 41.2,
      ingress_cost: 5.3,
      requests_cost: 18.6,
      total_cost: 157.6,
      rate_card_name: "Ops rate card",
    },
  },
};

const billingSubjectsRule: MockRule = {
  id: "admin-billing-subjects",
  path: /^\/admin\/billing\/subjects$/,
  body: {
    items: [
      {
        subject_type: "account",
        subject_id: 101,
        name: "Helios Retail",
        rgw_identifier: "RGW-HELIOS",
        storage: {
          avg_bytes: 2_350_000_000,
          avg_gb_month: 72.8,
          total_objects: 1_284_000,
        },
        usage: {
          bytes_in: 620_000_000,
          bytes_out: 2_100_000_000,
          ops_total: 12_450_000,
        },
        cost: {
          currency: "EUR",
          total_cost: 96.4,
        },
      },
    ],
    total: 1,
    page: 1,
    page_size: 200,
    has_next: false,
  },
};

const billingSubjectDetailRule: MockRule = {
  id: "admin-billing-subject-detail",
  path: /^\/admin\/billing\/subject\/account\/\d+$/,
  body: ({ url }) => {
    const subjectId = Number(url.pathname.split("/").at(-1) ?? "101");
    const detailById = {
      101: {
        month: "2026-03",
        subject_type: "account",
        subject_id: 101,
        name: "Helios Retail",
        rgw_identifier: "RGW-HELIOS",
        daily: [
          { day: "2026-03-01", storage_bytes: 2_180_000_000, bytes_in: 21_000_000, bytes_out: 78_000_000, ops_total: 430_000 },
          { day: "2026-03-05", storage_bytes: 2_260_000_000, bytes_in: 24_000_000, bytes_out: 82_000_000, ops_total: 455_000 },
          { day: "2026-03-10", storage_bytes: 2_320_000_000, bytes_in: 26_000_000, bytes_out: 84_000_000, ops_total: 468_000 },
          { day: "2026-03-15", storage_bytes: 2_380_000_000, bytes_in: 22_000_000, bytes_out: 79_000_000, ops_total: 447_000 },
          { day: "2026-03-20", storage_bytes: 2_440_000_000, bytes_in: 25_000_000, bytes_out: 88_000_000, ops_total: 479_000 },
          { day: "2026-03-25", storage_bytes: 2_510_000_000, bytes_in: 27_000_000, bytes_out: 92_000_000, ops_total: 498_000 },
          { day: "2026-03-27", storage_bytes: 2_550_000_000, bytes_in: 28_000_000, bytes_out: 94_000_000, ops_total: 505_000 },
        ],
        usage: {
          bytes_in: 620_000_000,
          bytes_out: 2_100_000_000,
          ops_total: 12_450_000,
        },
        storage: {
          avg_bytes: 2_350_000_000,
          avg_gb_month: 72.8,
          total_objects: 1_284_000,
        },
        coverage: {
          days_collected: 27,
          days_in_month: 31,
          coverage_ratio: 27 / 31,
        },
        cost: {
          currency: "EUR",
          total_cost: 96.4,
          rate_card_name: "Ops rate card",
        },
      },
      102: {
        month: "2026-03",
        subject_type: "account",
        subject_id: 102,
        name: "Northwind Ops",
        rgw_identifier: "RGW-NORTHWIND",
        daily: [
          { day: "2026-03-01", storage_bytes: 380_000_000, bytes_in: 6_000_000, bytes_out: 21_000_000, ops_total: 110_000 },
          { day: "2026-03-10", storage_bytes: 405_000_000, bytes_in: 5_000_000, bytes_out: 24_000_000, ops_total: 118_000 },
          { day: "2026-03-20", storage_bytes: 430_000_000, bytes_in: 4_000_000, bytes_out: 27_000_000, ops_total: 124_000 },
          { day: "2026-03-27", storage_bytes: 445_000_000, bytes_in: 7_000_000, bytes_out: 29_000_000, ops_total: 131_000 },
        ],
        usage: {
          bytes_in: 142_000_000,
          bytes_out: 680_000_000,
          ops_total: 3_120_000,
        },
        storage: {
          avg_bytes: 420_000_000,
          avg_gb_month: 13.0,
          total_objects: 212_000,
        },
        coverage: {
          days_collected: 27,
          days_in_month: 31,
          coverage_ratio: 27 / 31,
        },
        cost: {
          currency: "EUR",
          total_cost: 31.8,
          rate_card_name: "Ops rate card",
        },
      },
      103: {
        month: "2026-03",
        subject_type: "account",
        subject_id: 103,
        name: "BlueHarbor Data",
        rgw_identifier: "RGW-BLUEHARBOR",
        daily: [
          { day: "2026-03-01", storage_bytes: 160_000_000, bytes_in: 3_000_000, bytes_out: 18_000_000, ops_total: 92_000 },
          { day: "2026-03-10", storage_bytes: 172_000_000, bytes_in: 4_000_000, bytes_out: 20_000_000, ops_total: 95_000 },
          { day: "2026-03-20", storage_bytes: 184_000_000, bytes_in: 5_000_000, bytes_out: 23_000_000, ops_total: 99_000 },
          { day: "2026-03-27", storage_bytes: 196_000_000, bytes_in: 6_000_000, bytes_out: 24_000_000, ops_total: 101_000 },
        ],
        usage: {
          bytes_in: 150_000_000,
          bytes_out: 640_000_000,
          ops_total: 2_880_000,
        },
        storage: {
          avg_bytes: 180_000_000,
          avg_gb_month: 5.6,
          total_objects: 44_000,
        },
        coverage: {
          days_collected: 27,
          days_in_month: 31,
          coverage_ratio: 27 / 31,
        },
        cost: {
          currency: "EUR",
          total_cost: 22.5,
          rate_card_name: "Ops rate card",
        },
      },
    } as const;
    return detailById[subjectId as keyof typeof detailById] ?? detailById[101];
  },
};

const storageOpsBucketsPayload = {
  items: [
    {
      name: "acc-helios::helios-retail-logs",
      bucket_name: "helios-retail-logs",
      context_id: "acc-helios",
      context_name: "Helios Retail",
      context_kind: "account",
      endpoint_name: "Default",
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
        lifecycle: { state: "configured", tone: "active" },
      },
    },
    {
      name: "conn-blueharbor::northwind-iot-events",
      bucket_name: "northwind-iot-events",
      context_id: "conn-blueharbor",
      context_name: "BlueHarbor Shared Connection",
      context_kind: "connection",
      endpoint_name: "Archive",
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
  page_size: 25,
  has_next: false,
};

const storageOpsBucketsRule: MockRule = {
  id: "storage-ops-buckets",
  path: /^\/storage-ops\/buckets$/,
  body: storageOpsBucketsPayload,
};

const storageOpsBucketsStreamRule: MockRule = {
  id: "storage-ops-buckets-stream",
  path: /^\/storage-ops\/buckets\/stream$/,
  body: {
    result: storageOpsBucketsPayload,
  },
};

export const scenarios: DocScreenshotScenario[] = [
  {
    id: "user-overview",
    docPage: "user/index.md",
    route: "/admin",
    outputBasename: "user-overview",
    waitFor: "h1:has-text('Admin overview')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    mockRules: withBaseRules(),
  },
  {
    id: "start-here",
    docPage: "user/start-here.md",
    route: "/admin",
    outputBasename: "start-here",
    waitFor: "h1:has-text('Admin overview')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    actions: [{ type: "click", selector: "button[aria-label='Switch workspace']" }],
    mockRules: withBaseRules(),
  },
  {
    id: "use-cases-storage-admin",
    docPage: "user/use-cases-storage-admin.md",
    route: "/manager",
    outputBasename: "use-cases-storage-admin",
    waitFor: "h1:has-text('Manager dashboard')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "use-cases-storage-user",
    docPage: "user/use-cases-storage-user.md",
    route: "/browser",
    outputBasename: "use-cases-storage-user",
    waitFor: "button[aria-label='Upload'], button[aria-label='Upload files']",
    storage: {
      ...baseStorage(storageUser),
      selectedWorkspace: "browser",
      extraEntries: {
        [BROWSER_ROOT_UI_STATE_STORAGE_KEY]: browserAllPanelsStateEntry,
      },
    },
    actions: [
      { type: "wait", selector: "text=report-2026-03-08.json" },
      { type: "click", selector: "button:has-text('report-2026-03-08.json')" },
      { type: "click", selector: "button[role='tab']:has-text('Details')" },
      { type: "wait", selector: "text=source=docs" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-admin",
    docPage: "user/workspace-admin.md",
    route: "/admin",
    outputBasename: "workspace-admin",
    waitFor: "h1:has-text('Admin overview')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    mockRules: withBaseRules(),
  },
  {
    id: "feature-endpoint-status-admin",
    docPage: "user/feature-endpoint-status-admin.md",
    route: "/admin/endpoint-status",
    outputBasename: "admin-endpoint-status",
    waitFor: "h1:has-text('Endpoint Status')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    actions: [
      { type: "wait", selector: "text=Endpoint Latency" },
      { type: "wait", selector: "text=Endpoint Timelines" },
      { type: "wait", selector: "text=Incidents" },
      { type: "click", selector: "button:has-text('Degraded')" },
    ],
    mockRules: withBaseRules(
      endpointStatusLatencyOverviewRule,
      endpointStatusOverviewRule,
      endpointStatusGlobalIncidentsRule,
    ),
  },
  {
    id: "feature-billing-admin",
    docPage: "user/feature-billing-admin.md",
    route: "/admin/billing",
    outputBasename: "admin-billing",
    waitFor: "h1:has-text('Billing')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    actions: [
      { type: "wait", selector: "text=Estimated cost" },
      { type: "wait", selector: "tr:has-text('Helios Retail')" },
      { type: "click", selector: "tr:has-text('Helios Retail')" },
      { type: "wait", selector: "text=Coverage: 87% (27/31 days)" },
    ],
    mockRules: withBaseRules(
      billingEnabledGeneralSettingsRule,
      billingSummaryRule,
      billingSubjectsRule,
      billingSubjectDetailRule,
    ),
  },
  {
    id: "gallery-admin-ui-users",
    docPage: "user/screenshots-gallery.md",
    route: "/admin/users",
    outputBasename: "admin-ui-users",
    waitFor: "h1:has-text('UI Users')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    actions: [{ type: "wait", selector: "text=platform.admin@example.com" }],
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-admin-storage-endpoints",
    docPage: "user/screenshots-gallery.md",
    route: "/admin/storage-endpoints",
    outputBasename: "admin-storage-endpoints",
    waitFor: "h1:has-text('Storage endpoints')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    actions: [{ type: "wait", selector: "text=S3MADMINDEFAULT" }],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-manager",
    docPage: "user/workspace-manager.md",
    route: "/manager",
    outputBasename: "workspace-manager",
    waitFor: "h1:has-text('Manager dashboard')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-browser",
    docPage: "user/workspace-browser.md",
    route: "/browser?bucket=helios-retail-logs",
    outputBasename: "workspace-browser",
    waitFor: "button[aria-label='Upload'], button[aria-label='Upload files']",
    storage: { ...baseStorage(storageUser), selectedWorkspace: "browser" },
    actions: [{ type: "wait", selector: "text=daily/report-2026-03-08.json" }],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-ceph-admin",
    docPage: "user/workspace-ceph-admin.md",
    route: "/ceph-admin/buckets",
    outputBasename: "workspace-ceph-admin",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "ceph-admin" },
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-storage-ops",
    docPage: "user/workspace-storage-ops.md",
    route: "/storage-ops/buckets",
    outputBasename: "workspace-storage-ops",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(storageOpsAdminUser), selectedWorkspace: "storage-ops" },
    mockRules: withBaseRules(storageOpsEnabledGeneralSettingsRule, storageOpsBucketsRule, storageOpsBucketsStreamRule),
  },
  {
    id: "gallery-storage-ops-dashboard",
    docPage: "user/screenshots-gallery.md",
    route: "/storage-ops",
    outputBasename: "storage-ops-dashboard",
    waitFor: "h1:has-text('Storage Ops')",
    storage: { ...baseStorage(storageOpsAdminUser), selectedWorkspace: "storage-ops" },
    mockRules: withBaseRules(storageOpsEnabledGeneralSettingsRule, storageOpsBucketsRule, storageOpsBucketsStreamRule),
  },
  {
    id: "feature-buckets",
    docPage: "user/feature-buckets.md",
    route: "/manager/buckets",
    outputBasename: "feature-buckets",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "howto-manager-bucket-configuration",
    docPage: "user/howto-manager-bucket-configuration.md",
    route: "/manager/buckets",
    outputBasename: "manager-bucket-configuration",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "feature-iam",
    docPage: "user/feature-iam.md",
    route: "/manager/users",
    outputBasename: "feature-iam",
    waitFor: "h1:has-text('Users')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "feature-objects-browser",
    docPage: "user/feature-objects-browser.md",
    route: "/browser",
    outputBasename: "feature-objects-browser",
    waitFor: "button[aria-label='Upload'], button[aria-label='Upload files']",
    storage: {
      ...baseStorage(storageUser),
      selectedWorkspace: "browser",
      extraEntries: {
        [BROWSER_ROOT_UI_STATE_STORAGE_KEY]: browserAllPanelsStateEntry,
      },
    },
    actions: [
      { type: "wait", selector: "text=report-2026-03-08.json" },
      { type: "click", selector: "input[aria-label='Select all']" },
      { type: "click", selector: "[aria-label='Browser actions bar'] button:has-text('Delete')" },
      { type: "wait", selector: "text=Delete objects" },
      { type: "click", selector: "[role='dialog'] button:has-text('Delete')" },
      { type: "wait", selector: "text=Operations overview" },
      { type: "click", selector: "button:has-text('Show files')" },
      { type: "wait", selector: "text=errors-2026-03-08.log" },
    ],
    mockRules: withBaseRules(browserDelayedDeleteRule),
    postScreenshotWaitMs: 2500,
    postScreenshotActions: [
      { type: "click", selector: "[role='dialog'] button:has-text('Close')" },
    ],
  },
  {
    id: "feature-object-versions-browser",
    docPage: "user/feature-object-versions-browser.md",
    route: "/browser",
    outputBasename: "feature-object-versions-browser",
    waitFor: "button[aria-label='Upload'], button[aria-label='Upload files']",
    storage: {
      ...baseStorage(storageUser),
      selectedWorkspace: "browser",
      extraEntries: {
        [BROWSER_ROOT_UI_STATE_STORAGE_KEY]: browserAllPanelsStateEntry,
      },
    },
    actions: [
      { type: "wait", selector: "text=report-2026-03-08.json" },
      { type: "click", selector: "tr:has-text('report-2026-03-08.json') button[aria-label='More actions']" },
      { type: "click", selector: "[role='menu'] button:has-text('Versions')" },
      { type: "wait", selector: "text=Object versions · daily/report-2026-03-08.json" },
      { type: "wait", selector: "text=v: v-2026-03-08-0715" },
    ],
    mockRules: withBaseRules(
      browserVersioningEnabledRule,
      browserObjectVersionsRule,
    ),
  },
  {
    id: "feature-topics",
    docPage: "user/feature-topics.md",
    route: "/manager/topics",
    outputBasename: "feature-topics",
    waitFor: "h1:has-text('SNS Topics')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "howto-ceph-advanced-filter",
    docPage: "user/howto-ceph-advanced-filter.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-advanced-filter",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "ceph-admin" },
    actions: [
      { type: "click", selector: "button:has-text('Advanced filter')" },
      { type: "wait", selector: "p:has-text('Advanced filter')" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "howto-ceph-ui-tags",
    docPage: "user/howto-ceph-ui-tags.md",
    route: "/ceph-admin/buckets",
    outputBasename: "ceph-admin-ui-tags",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "ceph-admin" },
    actions: [
      { type: "click", selector: "table tbody tr:first-child input[type='checkbox']" },
      { type: "click", selector: "summary:has-text('Tag selection')" },
      { type: "wait", selector: "input[placeholder='new-tag']" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "howto-storage-ops-ui-tags",
    docPage: "user/howto-storage-ops-ui-tags.md",
    route: "/storage-ops/buckets",
    outputBasename: "storage-ops-ui-tags",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(storageOpsAdminUser), selectedWorkspace: "storage-ops" },
    actions: [
      { type: "click", selector: "table tbody tr:first-child input[type='checkbox']" },
      { type: "click", selector: "summary:has-text('Tag selection')" },
      { type: "wait", selector: "input[placeholder='new-tag']" },
    ],
    mockRules: withBaseRules(storageOpsEnabledGeneralSettingsRule, storageOpsBucketsRule, storageOpsBucketsStreamRule),
  },
  {
    id: "feature-bucket-compare",
    docPage: "user/feature-bucket-compare.md",
    route: "/manager/bucket-compare",
    outputBasename: "feature-bucket-compare",
    waitFor: "h1:has-text('Bucket compare')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    actions: [
      { type: "click", selector: "table tbody tr:first-child input[type='checkbox']" },
      { type: "click", selector: "button:has-text('Compare selected')" },
      { type: "wait", selector: "[role='dialog'] select" },
      { type: "select", selector: "[role='dialog'] select", value: "conn-blueharbor" },
      { type: "click", selector: "[role='dialog'] button:has-text('Run comparison')" },
      { type: "wait", selector: "text=With differences: 1" },
      { type: "wait", selector: "text=Different objects (4)" },
    ],
    mockRules: withBaseRules(bucketCompareWithDifferencesRule),
  },
  {
    id: "feature-bucket-migration",
    docPage: "user/feature-bucket-migration.md",
    route: "/manager/migrations",
    outputBasename: "feature-bucket-migration",
    waitFor: "h1:has-text('Bucket Migration')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "troubleshooting",
    docPage: "user/troubleshooting.md",
    route: "/manager/users",
    outputBasename: "troubleshooting",
    waitFor: "h1:has-text('Users')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager", selectedExecutionContextId: undefined },
    mockRules: withBaseRules(noManagerContextsRule),
  },
];

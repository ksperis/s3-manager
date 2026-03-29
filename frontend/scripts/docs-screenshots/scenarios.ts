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
    theme: "dark" as const,
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
    outputFile: "user-overview.png",
    waitFor: "h1:has-text('Admin overview')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    mockRules: withBaseRules(),
  },
  {
    id: "start-here",
    docPage: "user/start-here.md",
    route: "/admin",
    outputFile: "start-here.png",
    waitFor: "h1:has-text('Admin overview')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    actions: [{ type: "click", selector: "button[aria-label='Changer de workspace']" }],
    mockRules: withBaseRules(),
  },
  {
    id: "use-cases-storage-admin",
    docPage: "user/use-cases-storage-admin.md",
    route: "/manager",
    outputFile: "use-cases-storage-admin.png",
    waitFor: "h1:has-text('Manager dashboard')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "use-cases-storage-user",
    docPage: "user/use-cases-storage-user.md",
    route: "/browser",
    outputFile: "use-cases-storage-user.png",
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
    outputFile: "workspace-admin.png",
    waitFor: "h1:has-text('Admin overview')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-admin-ui-users",
    docPage: "user/screenshots-gallery.md",
    route: "/admin/users",
    outputFile: "admin-ui-users.png",
    waitFor: "h1:has-text('UI Users')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    actions: [{ type: "wait", selector: "text=platform.admin@example.com" }],
    mockRules: withBaseRules(),
  },
  {
    id: "gallery-admin-storage-endpoints",
    docPage: "user/screenshots-gallery.md",
    route: "/admin/storage-endpoints",
    outputFile: "admin-storage-endpoints.png",
    waitFor: "h1:has-text('Storage endpoints')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    actions: [{ type: "wait", selector: "text=S3MADMINDEFAULT" }],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-manager",
    docPage: "user/workspace-manager.md",
    route: "/manager",
    outputFile: "workspace-manager.png",
    waitFor: "h1:has-text('Manager dashboard')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-browser",
    docPage: "user/workspace-browser.md",
    route: "/browser?bucket=helios-retail-logs",
    outputFile: "workspace-browser.png",
    waitFor: "button[aria-label='Upload'], button[aria-label='Upload files']",
    storage: { ...baseStorage(storageUser), selectedWorkspace: "browser" },
    actions: [{ type: "wait", selector: "text=daily/report-2026-03-08.json" }],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-ceph-admin",
    docPage: "user/workspace-ceph-admin.md",
    route: "/ceph-admin/buckets",
    outputFile: "workspace-ceph-admin.png",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "ceph-admin" },
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-storage-ops",
    docPage: "user/workspace-storage-ops.md",
    route: "/storage-ops/buckets",
    outputFile: "workspace-storage-ops.png",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(storageOpsAdminUser), selectedWorkspace: "storage-ops" },
    mockRules: withBaseRules(storageOpsEnabledGeneralSettingsRule, storageOpsBucketsRule, storageOpsBucketsStreamRule),
  },
  {
    id: "gallery-storage-ops-dashboard",
    docPage: "user/screenshots-gallery.md",
    route: "/storage-ops",
    outputFile: "storage-ops-dashboard.png",
    waitFor: "h1:has-text('Storage Ops')",
    storage: { ...baseStorage(storageOpsAdminUser), selectedWorkspace: "storage-ops" },
    mockRules: withBaseRules(storageOpsEnabledGeneralSettingsRule, storageOpsBucketsRule, storageOpsBucketsStreamRule),
  },
  {
    id: "feature-buckets",
    docPage: "user/feature-buckets.md",
    route: "/manager/buckets",
    outputFile: "feature-buckets.png",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "howto-manager-bucket-configuration",
    docPage: "user/howto-manager-bucket-configuration.md",
    route: "/manager/buckets",
    outputFile: "manager-bucket-configuration.png",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "feature-iam",
    docPage: "user/feature-iam.md",
    route: "/manager/users",
    outputFile: "feature-iam.png",
    waitFor: "h1:has-text('Users')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "feature-objects-browser",
    docPage: "user/feature-objects-browser.md",
    route: "/browser",
    outputFile: "feature-objects-browser.png",
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
    outputFile: "feature-object-versions-browser.png",
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
    outputFile: "feature-topics.png",
    waitFor: "h1:has-text('SNS Topics')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "howto-ceph-advanced-filter",
    docPage: "user/howto-ceph-advanced-filter.md",
    route: "/ceph-admin/buckets",
    outputFile: "ceph-admin-advanced-filter.png",
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
    outputFile: "ceph-admin-ui-tags.png",
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
    outputFile: "storage-ops-ui-tags.png",
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
    outputFile: "feature-bucket-compare.png",
    waitFor: "h1:has-text('Bucket compare')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    actions: [
      { type: "click", selector: "table tbody tr:first-child input[type='checkbox']" },
      { type: "click", selector: "button:has-text('Compare selected')" },
      { type: "wait", selector: "label:has-text('Target context')" },
      { type: "select", selector: "label:has-text('Target context') + select", value: "conn-blueharbor" },
      { type: "click", selector: "button:has-text('Run comparison')" },
      { type: "wait", selector: "text=With differences: 1" },
      { type: "click", selector: "summary:has-text('Matched')" },
      { type: "click", selector: "summary:has-text('Content diff')" },
      { type: "wait", selector: "text=Different objects (4)" },
    ],
    mockRules: withBaseRules(bucketCompareWithDifferencesRule),
  },
  {
    id: "feature-bucket-migration",
    docPage: "user/feature-bucket-migration.md",
    route: "/manager/migrations",
    outputFile: "feature-bucket-migration.png",
    waitFor: "h1:has-text('Bucket Migration')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    mockRules: withBaseRules(),
  },
  {
    id: "troubleshooting",
    docPage: "user/troubleshooting.md",
    route: "/manager/users",
    outputFile: "troubleshooting.png",
    waitFor: "h1:has-text('Users')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager", selectedExecutionContextId: undefined },
    mockRules: withBaseRules(noManagerContextsRule),
  },
];

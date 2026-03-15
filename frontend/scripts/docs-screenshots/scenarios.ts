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

export const scenarios: DocScreenshotScenario[] = [
  {
    id: "user-overview",
    docPage: "user/index.md",
    route: "/admin",
    outputFile: "user-overview.png",
    waitFor: "h1:has-text('Admin overview')",
    storage: { ...baseStorage(superAdminUser), selectedWorkspace: "admin" },
    annotations: [
      { selector: "button[aria-label='Changer de workspace']", label: "Workspace selector", side: "top" },
      { selector: "a[href='/admin/users']", label: "Platform administration section", side: "right" },
      { selector: "h1:has-text('Admin overview')", label: "Workspace landing dashboard", side: "bottom" },
    ],
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
    annotations: [
      { selector: "button[aria-label='Changer de workspace']", label: "Open available workspaces", side: "top" },
      { selector: "[role='listbox'][aria-label='Changer de workspace']", label: "Choose the workspace for the task", side: "right" },
      { selector: "[role='listbox'][aria-label='Changer de workspace'] [role='option']", label: "Pick the destination workspace", side: "bottom" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "use-cases-storage-admin",
    docPage: "user/use-cases-storage-admin.md",
    route: "/manager",
    outputFile: "use-cases-storage-admin.png",
    waitFor: "h1:has-text('Manager dashboard')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    annotations: [
      { selector: "a[href='/manager/buckets']", label: "Buckets and browser operations", side: "right" },
      { selector: "a[href='/manager/users']", label: "Identity and access administration", side: "right", offsetY: 46 },
      { selector: "a[href='/manager/bucket-compare']", label: "Compare and migration tooling", side: "right", offsetY: 92 },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "use-cases-storage-user",
    docPage: "user/use-cases-storage-user.md",
    route: "/browser",
    outputFile: "use-cases-storage-user.png",
    waitFor: "button[aria-label='Upload files']",
    storage: { ...baseStorage(storageUser), selectedWorkspace: "browser" },
    annotations: [
      { selector: "button[aria-label='Select bucket']", label: "Pick the target bucket", side: "top" },
      { selector: "button[aria-label='Upload files']", label: "Upload objects", side: "top", offsetX: 80 },
      { selector: "input[placeholder='Search objects']", label: "Search and filter object keys", side: "right" },
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
    annotations: [
      { selector: "a[href='/admin/users']", label: "UI users and platform controls", side: "right" },
      { selector: "a[href='/admin/s3-accounts']", label: "RGW accounts and users", side: "right", offsetY: 50 },
      { selector: "a[href='/admin/audit']", label: "Audit and governance data", side: "right", offsetY: 95 },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-manager",
    docPage: "user/workspace-manager.md",
    route: "/manager",
    outputFile: "workspace-manager.png",
    waitFor: "h1:has-text('Manager dashboard')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    annotations: [
      { selector: "a[href='/manager/buckets']", label: "Bucket administration", side: "right" },
      { selector: "a[href='/manager/topics']", label: "SNS topic management", side: "right", offsetY: 45 },
      { selector: "a[href='/manager/migrations']", label: "Compare and migration", side: "right", offsetY: 88 },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-browser",
    docPage: "user/workspace-browser.md",
    route: "/browser",
    outputFile: "workspace-browser.png",
    waitFor: "button[aria-label='Upload files']",
    storage: { ...baseStorage(storageUser), selectedWorkspace: "browser" },
    annotations: [
      { selector: "button[aria-label='Select bucket']", label: "Current bucket context", side: "top" },
      { selector: "button[aria-label='Upload files']", label: "Object actions toolbar", side: "top", offsetX: 90 },
      { selector: "button:has-text('Operations')", label: "Track running operations", side: "right" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "workspace-ceph-admin",
    docPage: "user/workspace-ceph-admin.md",
    route: "/ceph-admin/buckets",
    outputFile: "workspace-ceph-admin.png",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "ceph-admin" },
    annotations: [
      { selector: "text=Endpoint: Default", label: "Cluster endpoint selector", side: "top" },
      { selector: "a[href='/ceph-admin/accounts']", label: "RGW admin navigation", side: "right" },
      { selector: "h1:has-text('Buckets')", label: "Cluster bucket inventory", side: "bottom" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "feature-buckets",
    docPage: "user/feature-buckets.md",
    route: "/manager/buckets",
    outputFile: "feature-buckets.png",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    annotations: [
      { selector: "button:has-text('Create bucket')", label: "Create a bucket", side: "top" },
      { selector: "button:has-text('Columns')", label: "Adapt visible columns", side: "top", offsetX: 120 },
      { selector: "table", label: "Inspect and edit bucket configuration", side: "bottom" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "howto-manager-bucket-configuration",
    docPage: "user/howto-manager-bucket-configuration.md",
    route: "/manager/buckets",
    outputFile: "manager-bucket-configuration.png",
    waitFor: "h1:has-text('Buckets')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    annotations: [
      { selector: "h1:has-text('Buckets')", label: "Start from the Manager bucket inventory", side: "bottom" },
      { selector: "table tbody tr:first-child a:has-text('Configure')", label: "Open bucket configuration for the selected bucket", side: "right" },
      { selector: "button:has-text('Create bucket')", label: "Create new buckets when needed", side: "top" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "feature-iam",
    docPage: "user/feature-iam.md",
    route: "/manager/users",
    outputFile: "feature-iam.png",
    waitFor: "h1:has-text('Users')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    annotations: [
      { selector: "button:has-text('Create user')", label: "Create IAM users", side: "top" },
      { selector: "table", label: "Review principals and attachments", side: "bottom" },
      { selector: "a[href='/manager/groups']", label: "Navigate to groups/roles/policies", side: "right" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "feature-objects-browser",
    docPage: "user/feature-objects-browser.md",
    route: "/browser",
    outputFile: "feature-objects-browser.png",
    waitFor: "button[aria-label='Upload files']",
    storage: { ...baseStorage(storageUser), selectedWorkspace: "browser" },
    annotations: [
      { selector: "button[aria-label='Upload files']", label: "Upload and manage files", side: "top" },
      { selector: "button:has-text('Operations')", label: "Monitor transfers and actions", side: "right" },
      { selector: "input[placeholder='Search objects']", label: "Filter objects by key name", side: "top", offsetX: 200 },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "feature-topics",
    docPage: "user/feature-topics.md",
    route: "/manager/topics",
    outputFile: "feature-topics.png",
    waitFor: "h1:has-text('SNS Topics')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager" },
    annotations: [
      { selector: "button:has-text('Create topic')", label: "Create a topic", side: "top" },
      { selector: "table", label: "View topics and subscriptions", side: "bottom" },
      { selector: "button:has-text('Policy')", label: "Policy and configuration actions", side: "right" },
    ],
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
    annotations: [
      { selector: "button:has-text('Advanced filter')", label: "Open the advanced filtering drawer", side: "top" },
      { selector: "p:has-text('Advanced filter')", label: "Compose filter rules by scope and cost", side: "left" },
      { selector: "button:has-text('Apply filters')", label: "Apply the draft filters to the bucket table", side: "left" },
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
    annotations: [
      { selector: "text=bucket selected", label: "Select one or more buckets to enable bulk tagging", side: "top" },
      { selector: "summary:has-text('Tag selection')", label: "Use tag actions for the current selection", side: "top", offsetX: 120 },
      { selector: "input[placeholder='new-tag']", label: "Add a custom UI tag and apply it", side: "right" },
    ],
    mockRules: withBaseRules(),
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
    annotations: [
      { selector: "button:has-text('Run comparison')", label: "Run the comparison on selected bucket mappings", side: "top" },
      { selector: "text=With differences: 1", label: "Comparison summary confirms detected differences", side: "bottom" },
      { selector: "text=Different objects (4)", label: "Inspect object-level differences in the result details", side: "right" },
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
    annotations: [
      { selector: "button:has-text('New migration')", label: "Start a migration workflow", side: "top" },
      { selector: "button:has-text('Active')", label: "Track active migrations", side: "top", offsetX: -80 },
      { selector: "text=Migration #31", label: "Inspect run status and progress", side: "right" },
    ],
    mockRules: withBaseRules(),
  },
  {
    id: "troubleshooting",
    docPage: "user/troubleshooting.md",
    route: "/manager/users",
    outputFile: "troubleshooting.png",
    waitFor: "h1:has-text('Users')",
    storage: { ...baseStorage(adminUser), selectedWorkspace: "manager", selectedExecutionContextId: undefined },
    annotations: [
      { selector: "text=No account selected", label: "Verify current context first", side: "top" },
      { selector: "text=Select an account before creating or listing users.", label: "Missing context explains unavailable actions", side: "bottom" },
      { selector: "text=No users.", label: "Capture exact user-facing state", side: "bottom", offsetX: 180 },
    ],
    mockRules: withBaseRules(noManagerContextsRule),
  },
];

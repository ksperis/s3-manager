/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3Account } from "./accounts";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import { PortalSettings, PortalSettingsOverride } from "./appSettings";
import type { BucketUsageStatsAggregateResponse } from "./bucketUsageStats";
import type { ManagerUsageTrendsResponse } from "./stats";
import type { UsageHistoryTrendResponse, UsageHistoryTrendWindow } from "./usageHistory";

export type PortalAccessKey = {
  access_key_id: string;
  status?: string | null;
  created_at?: string | null;
  is_active?: boolean | null;
  is_portal?: boolean;
  deletable?: boolean;
  secret_access_key?: string | null;
  session_token?: string | null;
  expires_at?: string | null;
};

export type PortalIAMUser = {
  iam_user_id?: string | null;
  iam_username?: string | null;
  arn?: string | null;
  created_at?: string | null;
};

export type PortalState = {
  account_id: number;
  iam_user: PortalIAMUser;
  access_keys: PortalAccessKey[];
  iam_provisioned?: boolean;
  max_buckets?: number | null;
  s3_endpoint?: string | null;
  used_bytes?: number | null;
  used_objects?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  just_created?: boolean;
  account_role?: string | null;
  can_manage_buckets?: boolean;
  can_create_storage_spaces?: boolean;
  can_manage_portal_users?: boolean;
  allow_named_bucket_create?: boolean;
};

export type PortalAccessKeysState = {
  iam_user: PortalIAMUser;
  s3_endpoint?: string | null;
  access_keys: PortalAccessKey[];
  can_manage_access_keys: boolean;
  max_access_keys: number;
};

export type PortalAccessKeyScopeAccount = {
  account_id: number;
  account_name: string;
  display_name: string;
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_url?: string | null;
  storage_endpoint_zonegroup?: string | null;
};

export type PortalAccessKeyScope = {
  scope_id: string;
  label: string;
  zonegroup?: string | null;
  s3_endpoint?: string | null;
  accounts: PortalAccessKeyScopeAccount[];
  iam_user: PortalIAMUser;
  access_keys: PortalAccessKey[];
  can_manage_access_keys: boolean;
  max_access_keys: number;
  unavailable_reason?: string | null;
};

export type PortalProjectAccessKeysState = {
  scopes: PortalAccessKeyScope[];
};

export type PortalUsage = {
  used_bytes?: number | null;
  used_objects?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  storage_spaces?: PortalUsageStorageSpace[];
  other_storage_space?: PortalUsageStorageSpace | null;
  accounts?: PortalUsageAccount[];
};

export type PortalUsageStorageSpace = {
  id: string;
  name: string;
  account_id?: number | null;
  project_account_label?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
};

export type PortalUsageAccount = {
  account_id: number;
  account_name: string;
  display_name: string;
  rgw_account_id?: string | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_zonegroup?: string | null;
  used_bytes?: number | null;
  used_objects?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  storage_space_count?: number;
};

export type PortalUsageAccountTrend = {
  account_id: number;
  account_name: string;
  display_name: string;
  rgw_account_id?: string | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_zonegroup?: string | null;
  trend: UsageHistoryTrendResponse;
};

export type PortalUsageAccountTrends = {
  window: UsageHistoryTrendWindow;
  available: boolean;
  unavailable_reason?: string | null;
  accounts: PortalUsageAccountTrend[];
};

export type PortalStorageSpaceRole = "Viewer" | "Editor" | "Owner";
export type PortalStorageSpaceVisibility = "private" | "shared";
export type PortalStorageSpaceShareScope = "restricted" | "account";
export type PortalStorageSpaceAccountMemberRole = "Viewer" | "Editor";

export type PortalStorageSpaceSummary = {
  id: string;
  name: string;
  account_id?: number | null;
  project_account_label?: string | null;
  role: PortalStorageSpaceRole;
  content_role?: PortalStorageSpaceRole | null;
  can_browse?: boolean | null;
  status?: string | null;
  description?: string | null;
  owner_label?: string | null;
  owner_user_id?: number | null;
  visibility?: PortalStorageSpaceVisibility;
  share_scope?: PortalStorageSpaceShareScope;
  account_member_role?: PortalStorageSpaceAccountMemberRole | null;
  project_key?: string | null;
  dataset_label?: string | null;
  region?: string | null;
  created_at?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  internal_bucket_name?: string | null;
  archived_at?: string | null;
  origin?: "portal_generic" | "portal_named" | "imported";
  name_editable?: boolean;
};

export type PortalStorageSpace = PortalStorageSpaceSummary;

export type PortalStorageSpaceInitialShare = {
  user_id: number;
  role: PortalStorageSpaceRole;
};

export type PortalStorageSpaceCreate = {
  name: string;
  account_id?: number | null;
  naming_mode?: "generic_uuid" | "named_bucket";
  description?: string | null;
  owner_label?: string | null;
  visibility?: PortalStorageSpaceVisibility;
  share_scope?: PortalStorageSpaceShareScope;
  account_member_role?: PortalStorageSpaceAccountMemberRole | null;
  initial_shares?: PortalStorageSpaceInitialShare[];
  project_key?: string | null;
  dataset_label?: string | null;
};

export type PortalStorageSpaceImport = {
  bucket_name: string;
  account_id?: number | null;
  description?: string | null;
  owner_label?: string | null;
  visibility?: PortalStorageSpaceVisibility;
  share_scope?: PortalStorageSpaceShareScope;
  account_member_role?: PortalStorageSpaceAccountMemberRole | null;
  initial_shares?: PortalStorageSpaceInitialShare[];
  project_key?: string | null;
  dataset_label?: string | null;
};

export type PortalStorageSpaceUpdate = Partial<PortalStorageSpaceCreate> & {
  archived?: boolean;
};

export type PortalStorageObjectDetail = {
  key: string;
  name: string;
  size?: number | null;
  last_modified?: string | null;
  content_type?: string | null;
  storage_class?: string | null;
  encryption?: string | null;
  preview_type: "text" | "image" | "unavailable";
  preview_text?: string | null;
  preview_unavailable_reason?: string | null;
};

export type PortalStorageObjectDownload = {
  blob: Blob;
  filename: string;
};

export type PortalStorageSpaceShareDirection = "with_me" | "by_me";

export type PortalStorageSpaceShare = {
  id: string;
  storage_space_id: string;
  storage_space_name: string;
  user_id?: number | null;
  email: string;
  role: PortalStorageSpaceRole;
  direction: PortalStorageSpaceShareDirection;
  activity_label?: string | null;
};

export type PortalStorageSpaceAccessPerson = {
  user_id?: number | null;
  email: string;
  display_name?: string | null;
  role: PortalStorageSpaceRole;
  account_role?: string | null;
  access_source?: "owner" | "direct" | "group" | "direct_and_group" | null;
};

export type PortalStorageSpaceAccessSummary = {
  mode: "private" | "all" | "restricted";
  default_account_member_role?: PortalStorageSpaceAccountMemberRole | null;
  owner: PortalStorageSpaceAccessPerson;
  effective_member_count: number;
  explicit_shares: PortalStorageSpaceShare[];
  public_link_count: number;
  can_manage_access: boolean;
  can_create_public_links: boolean;
};

export type PortalStorageSpaceShareCandidate = {
  user_id: number;
  email: string;
  display_name?: string | null;
  account_role: string;
  access_source: "direct" | "group" | "direct_and_group";
  already_shared?: boolean;
};

export type PortalPublicLink = {
  id: number;
  storage_space_id: string;
  storage_space_name: string;
  object_key: string;
  object_name: string;
  url: string;
  label?: string | null;
  created_by_email?: string | null;
  created_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  status: string;
};

export type PortalActivityItem = {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  target: string;
  storage_space_id?: string | null;
  storage_space_name?: string | null;
  ip_address?: string | null;
  status: string;
};

export type PortalTransfer = {
  id: string;
  name: string;
  direction: "Upload" | "Download";
  status: "Completed" | "Uploading" | "Queued" | "Failed";
  progress: number;
  size_bytes?: number | null;
  storage_space_id?: string | null;
  storage_space_name?: string | null;
  started_at: string;
  eta_label: string;
  speed_label: string;
  error_message?: string | null;
};

export type PortalAlert = {
  id: string;
  tone: "info" | "warning" | "danger";
  title: string;
  description: string;
  severity_label: string;
  storage_space_id?: string | null;
  created_at?: string | null;
};

export type PortalAccountSettings = {
  effective: PortalSettings;
  admin_override: PortalSettingsOverride;
};

export type PortalProjectAccount = {
  account_id: number;
  account_name: string;
  display_name: string;
  rgw_account_id?: string | null;
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_url?: string | null;
  storage_endpoint_zonegroup?: string | null;
  quota_max_size_gb?: number | null;
  quota_max_objects?: number | null;
};

export type PortalProject = {
  id: string;
  db_id: number;
  name: string;
  description?: string | null;
  account_role: "portal_user" | "portal_manager" | string;
  accounts: PortalProjectAccount[];
};

export type PortalReplicationStorageSpace = {
  id: string;
  name: string;
  bucket_name: string;
  account_id: number;
  account_name: string;
  project_account_label?: string | null;
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_zonegroup?: string | null;
  storage_endpoint_zone_name?: string | null;
  bucket_replication_allowed: boolean;
  bucket_replication_target_zones: string[];
  bucket_replication_owner_mode: "rgw_user_only" | "rgw_account_supported";
  bucket_replication_unavailable_reason?: string | null;
  global_replication_configured: boolean;
  can_manage: boolean;
};

export type PortalReplicationSummary = {
  id: string;
  mode: "bucket_level" | "global";
  status: "configured" | "unavailable" | "error";
  source: PortalReplicationStorageSpace;
  target?: PortalReplicationStorageSpace | null;
  target_bucket_name?: string | null;
  zonegroup?: string | null;
  rule_id?: string | null;
  role_arn?: string | null;
  message?: string | null;
};

export type PortalReplicationList = {
  storage_spaces: PortalReplicationStorageSpace[];
  replications: PortalReplicationSummary[];
  can_create: boolean;
  unavailable_reason?: string | null;
};

export type PortalReplicationCreate = {
  source_storage_space_id: string;
  target_storage_space_id: string;
};

export function isPortalProjectSelector(accountId: S3AccountSelector): accountId is string {
  return typeof accountId === "string" && accountId.startsWith("proj-");
}

function projectIdFromSelector(accountId: S3AccountSelector): string | null {
  if (!isPortalProjectSelector(accountId)) return null;
  return accountId.slice("proj-".length);
}

function portalProjectPath(accountId: S3AccountSelector, suffix: string): string | null {
  const projectId = projectIdFromSelector(accountId);
  return projectId ? `/portal/projects/${encodeURIComponent(projectId)}${suffix}` : null;
}

function emptyPortalTraffic(window: import("./stats").TrafficWindow): import("./stats").ManagerTrafficStats {
  const now = new Date().toISOString();
  return {
    window,
    start: now,
    end: now,
    resolution: "none",
    data_points: 0,
    series: [],
    totals: { bytes_in: 0, bytes_out: 0, ops: 0, success_ops: 0, success_rate: null },
    bucket_rankings: [],
    user_rankings: [],
    request_breakdown: [],
    category_breakdown: [],
  };
}

function emptyUsageStatsAggregate(): BucketUsageStatsAggregateResponse {
  return {
    aggregate: {
      scope_kind: "portal_project",
      scope_id: "project",
      bucket_count: 0,
      buckets_with_snapshot: 0,
      missing_bucket_count: 0,
      partial_scan_count: 0,
      object_version_count: 0,
      current_version_count: 0,
      noncurrent_version_count: 0,
      delete_marker_count: 0,
      total_bytes: 0,
      current_bytes: 0,
      noncurrent_bytes: 0,
      data_type_distribution: [],
      storage_class_distribution: [],
      size_distribution: [],
      age_distribution: [],
      current_vs_noncurrent: [],
      warnings: [],
    },
  };
}

export async function listPortalAccounts(): Promise<S3Account[]> {
  const { data } = await client.get<S3Account[]>("/portal/accounts");
  return data;
}

export async function listPortalProjects(): Promise<PortalProject[]> {
  const { data } = await client.get<PortalProject[]>("/portal/projects");
  return data;
}

export async function listPortalReplications(accountId: S3AccountSelector): Promise<PortalReplicationList> {
  const projectPath = portalProjectPath(accountId, "/replications");
  if (projectPath) {
    const { data } = await client.get<PortalReplicationList>(projectPath);
    return data;
  }
  const { data } = await client.get<PortalReplicationList>("/portal/replications", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function createPortalReplication(
  accountId: S3AccountSelector,
  payload: PortalReplicationCreate
): Promise<PortalReplicationSummary> {
  const projectPath = portalProjectPath(accountId, "/replications");
  if (projectPath) {
    const { data } = await client.post<PortalReplicationSummary>(projectPath, payload);
    return data;
  }
  const { data } = await client.post<PortalReplicationSummary>("/portal/replications", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchPortalState(accountId: S3AccountSelector): Promise<PortalState> {
  const projectPath = portalProjectPath(accountId, "/state");
  if (projectPath) {
    const { data } = await client.get<PortalState>(projectPath);
    return data;
  }
  const { data } = await client.get<PortalState>("/portal/state", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function fetchPortalAccessKeysState(accountId: S3AccountSelector): Promise<PortalAccessKeysState> {
  if (isPortalProjectSelector(accountId)) {
    throw new Error("Use fetchPortalProjectAccessKeysState for project access keys.");
  }
  const { data } = await client.get<PortalAccessKeysState>("/portal/access-keys", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchPortalProjectAccessKeysState(accountId: S3AccountSelector): Promise<PortalProjectAccessKeysState> {
  const projectPath = portalProjectPath(accountId, "/access-keys");
  if (!projectPath) {
    throw new Error("Project access keys require a project context.");
  }
  const { data } = await client.get<PortalProjectAccessKeysState>(projectPath);
  return data;
}

export async function createPortalAccessKey(accountId: S3AccountSelector): Promise<PortalAccessKey> {
  if (isPortalProjectSelector(accountId)) {
    throw new Error("Use createPortalProjectAccessKey for project access keys.");
  }
  const { data } = await client.post<PortalAccessKey>(
    "/portal/access-keys",
    undefined,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function createPortalProjectAccessKey(
  accountId: S3AccountSelector,
  scopeId: string
): Promise<PortalAccessKey> {
  const projectPath = portalProjectPath(accountId, `/access-keys/${encodeURIComponent(scopeId)}`);
  if (!projectPath) {
    throw new Error("Project access keys require a project context.");
  }
  const { data } = await client.post<PortalAccessKey>(projectPath);
  return data;
}

export async function updatePortalAccessKeyStatus(
  accountId: S3AccountSelector,
  accessKeyId: string,
  active: boolean
): Promise<PortalAccessKey> {
  if (isPortalProjectSelector(accountId)) {
    throw new Error("Use updatePortalProjectAccessKeyStatus for project access keys.");
  }
  const { data } = await client.put<PortalAccessKey>(
    `/portal/access-keys/${encodeURIComponent(accessKeyId)}/status`,
    { active },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updatePortalProjectAccessKeyStatus(
  accountId: S3AccountSelector,
  scopeId: string,
  accessKeyId: string,
  active: boolean
): Promise<PortalAccessKey> {
  const projectPath = portalProjectPath(
    accountId,
    `/access-keys/${encodeURIComponent(scopeId)}/${encodeURIComponent(accessKeyId)}/status`
  );
  if (!projectPath) {
    throw new Error("Project access keys require a project context.");
  }
  const { data } = await client.put<PortalAccessKey>(projectPath, { active });
  return data;
}

export async function deletePortalAccessKey(accountId: S3AccountSelector, accessKeyId: string): Promise<void> {
  if (isPortalProjectSelector(accountId)) {
    throw new Error("Use deletePortalProjectAccessKey for project access keys.");
  }
  await client.delete(`/portal/access-keys/${encodeURIComponent(accessKeyId)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function deletePortalProjectAccessKey(
  accountId: S3AccountSelector,
  scopeId: string,
  accessKeyId: string
): Promise<void> {
  const projectPath = portalProjectPath(
    accountId,
    `/access-keys/${encodeURIComponent(scopeId)}/${encodeURIComponent(accessKeyId)}`
  );
  if (!projectPath) {
    throw new Error("Project access keys require a project context.");
  }
  await client.delete(projectPath);
}

export async function fetchPortalUsage(accountId: S3AccountSelector): Promise<PortalUsage> {
  const projectPath = portalProjectPath(accountId, "/usage");
  if (projectPath) {
    const { data } = await client.get<PortalUsage>(projectPath);
    return data;
  }
  const { data } = await client.get<PortalUsage>("/portal/usage", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function fetchPortalUsageTrends(accountId: S3AccountSelector): Promise<ManagerUsageTrendsResponse> {
  if (isPortalProjectSelector(accountId)) {
    return {};
  }
  const { data } = await client.get<ManagerUsageTrendsResponse>("/portal/usage-trends", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function getPortalUsageStatsAggregate(
  accountId: S3AccountSelector
): Promise<BucketUsageStatsAggregateResponse> {
  if (isPortalProjectSelector(accountId)) {
    return emptyUsageStatsAggregate();
  }
  const { data } = await client.get<BucketUsageStatsAggregateResponse>(
    "/portal/usage-stats/latest",
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function fetchPortalUsageHistoryTrends(
  accountId: S3AccountSelector,
  window: UsageHistoryTrendWindow
): Promise<UsageHistoryTrendResponse> {
  if (isPortalProjectSelector(accountId)) {
    return {
      window,
      granularity: "daily",
      available: false,
      unavailable_reason: "Project usage history is not collected yet.",
      points: [],
      summary: {
        total_records: 0,
        points_count: 0,
        subjects_count: 0,
        latest_used_bytes: 0,
        latest_used_objects: 0,
        latest_bucket_count: 0,
      },
    };
  }
  const { data } = await client.get<UsageHistoryTrendResponse>(
    "/portal/usage-history-trends",
    { params: withS3AccountParam({ window }, accountId) }
  );
  return data;
}

export async function fetchPortalAccountUsageTrends(
  accountId: S3AccountSelector,
  window: UsageHistoryTrendWindow
): Promise<PortalUsageAccountTrends> {
  const projectPath = portalProjectPath(accountId, "/account-usage-trends");
  if (projectPath) {
    const { data } = await client.get<PortalUsageAccountTrends>(projectPath, { params: { window } });
    return data;
  }
  return {
    window,
    available: false,
    unavailable_reason: "Account usage trends are available for portal projects.",
    accounts: [],
  };
}

export async function fetchPortalActivity(
  accountId: S3AccountSelector,
  options?: { spaceId?: string; limit?: number }
): Promise<PortalActivityItem[]> {
  const baseParams: Record<string, string | number> = {};
  if (options?.spaceId) baseParams.space_id = options.spaceId;
  if (options?.limit) baseParams.limit = options.limit;
  const projectPath = portalProjectPath(accountId, "/activity");
  if (projectPath) {
    const { data } = await client.get<PortalActivityItem[]>(projectPath, { params: baseParams });
    return data;
  }
  const { data } = await client.get<PortalActivityItem[]>("/portal/activity", {
    params: withS3AccountParam(baseParams, accountId),
  });
  return data;
}

export async function fetchPortalTransfers(
  accountId: S3AccountSelector,
  options?: { spaceId?: string; limit?: number }
): Promise<PortalTransfer[]> {
  const baseParams: Record<string, string | number> = {};
  if (options?.spaceId) baseParams.space_id = options.spaceId;
  if (options?.limit) baseParams.limit = options.limit;
  const projectPath = portalProjectPath(accountId, "/transfers");
  if (projectPath) {
    const { data } = await client.get<PortalTransfer[]>(projectPath, { params: baseParams });
    return data;
  }
  const { data } = await client.get<PortalTransfer[]>("/portal/transfers", {
    params: withS3AccountParam(baseParams, accountId),
  });
  return data;
}

export async function fetchPortalAlerts(accountId: S3AccountSelector, limit = 50): Promise<PortalAlert[]> {
  const projectPath = portalProjectPath(accountId, "/alerts");
  if (projectPath) {
    const { data } = await client.get<PortalAlert[]>(projectPath, { params: { limit } });
    return data;
  }
  const { data } = await client.get<PortalAlert[]>("/portal/alerts", {
    params: withS3AccountParam({ limit }, accountId),
  });
  return data;
}

export async function listPortalStorageSpaces(
  accountId: S3AccountSelector,
  options?: { search?: string; role?: PortalStorageSpaceRole; status?: string; sort?: string; includeArchived?: boolean }
): Promise<PortalStorageSpaceSummary[]> {
  const baseParams: Record<string, string | boolean> = {};
  if (options?.search) {
    baseParams.search = options.search;
  }
  if (options?.role) {
    baseParams.role = options.role;
  }
  if (options?.status) {
    baseParams.status = options.status;
  }
  if (options?.sort) {
    baseParams.sort = options.sort;
  }
  if (options?.includeArchived) {
    baseParams.include_archived = true;
  }
  const projectPath = portalProjectPath(accountId, "/storage-spaces");
  if (projectPath) {
    const { data } = await client.get<PortalStorageSpaceSummary[]>(projectPath, { params: baseParams });
    return data;
  }
  const { data } = await client.get<PortalStorageSpaceSummary[]>("/portal/storage-spaces", {
    params: withS3AccountParam(baseParams, accountId),
  });
  return data;
}

export async function createPortalStorageSpace(
  accountId: S3AccountSelector,
  payload: PortalStorageSpaceCreate
): Promise<PortalStorageSpace> {
  const projectPath = portalProjectPath(accountId, "/storage-spaces");
  if (projectPath) {
    const { data } = await client.post<PortalStorageSpace>(projectPath, payload);
    return data;
  }
  const { data } = await client.post<PortalStorageSpace>("/portal/storage-spaces", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function importPortalStorageSpace(
  accountId: S3AccountSelector,
  payload: PortalStorageSpaceImport
): Promise<PortalStorageSpace> {
  const projectPath = portalProjectPath(accountId, "/storage-spaces/import");
  if (projectPath) {
    const { data } = await client.post<PortalStorageSpace>(projectPath, payload);
    return data;
  }
  const { data } = await client.post<PortalStorageSpace>("/portal/storage-spaces/import", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchPortalStorageSpace(
  accountId: S3AccountSelector,
  spaceId: string
): Promise<PortalStorageSpace> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}`);
  if (projectPath) {
    const { data } = await client.get<PortalStorageSpace>(projectPath);
    return data;
  }
  const { data } = await client.get<PortalStorageSpace>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updatePortalStorageSpace(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: PortalStorageSpaceUpdate
): Promise<PortalStorageSpace> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}`);
  if (projectPath) {
    const { data } = await client.patch<PortalStorageSpace>(projectPath, payload);
    return data;
  }
  const { data } = await client.patch<PortalStorageSpace>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function fetchPortalStorageSpaceAccessSummary(
  accountId: S3AccountSelector,
  spaceId: string
): Promise<PortalStorageSpaceAccessSummary> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/access-summary`);
  if (projectPath) {
    const { data } = await client.get<PortalStorageSpaceAccessSummary>(projectPath);
    return data;
  }
  const { data } = await client.get<PortalStorageSpaceAccessSummary>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/access-summary`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function fetchPortalStorageSpaceObjectDetail(
  accountId: S3AccountSelector,
  spaceId: string,
  key: string
): Promise<PortalStorageObjectDetail> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/objects/detail`);
  if (projectPath) {
    const { data } = await client.get<PortalStorageObjectDetail>(projectPath, { params: { key } });
    return data;
  }
  const { data } = await client.get<PortalStorageObjectDetail>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects/detail`,
    { params: withS3AccountParam({ key }, accountId) }
  );
  return data;
}

export async function deletePortalStorageSpaceObject(
  accountId: S3AccountSelector,
  spaceId: string,
  key: string
): Promise<void> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/objects`);
  if (projectPath) {
    await client.delete(projectPath, { params: { key } });
    return;
  }
  await client.delete(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects`,
    { params: withS3AccountParam({ key }, accountId) }
  );
}

function filenameFromContentDisposition(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const extended = value.match(/filename\*\s*=\s*([^;]+)/i);
  if (extended?.[1]) {
    const raw = extended[1].trim().replace(/^"|"$/g, "");
    const encoded = raw.includes("''") ? raw.split("''").at(-1) ?? raw : raw;
    try {
      const decoded = decodeURIComponent(encoded);
      return decoded.split("/").filter(Boolean).at(-1) ?? fallback;
    } catch {
      return encoded.split("/").filter(Boolean).at(-1) ?? fallback;
    }
  }
  const basic = value.match(/filename\s*=\s*"?([^";]+)"?/i);
  return basic?.[1]?.split("/").filter(Boolean).at(-1) ?? fallback;
}

export async function downloadPortalStorageSpaceObject(
  accountId: S3AccountSelector,
  spaceId: string,
  key: string
): Promise<PortalStorageObjectDownload> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/objects/download`);
  const response = await client.get<Blob>(
    projectPath ?? `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects/download`,
    {
      params: projectPath ? { key } : withS3AccountParam({ key }, accountId),
      responseType: "blob",
    }
  );
  const fallback = key.split("/").filter(Boolean).at(-1) ?? "download";
  const filename = filenameFromContentDisposition(response.headers?.["content-disposition"], fallback);
  return { blob: response.data, filename };
}

export async function listPortalStorageSpaceShares(
  accountId: S3AccountSelector,
  spaceId: string
): Promise<PortalStorageSpaceShare[]> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/shares`);
  if (projectPath) {
    const { data } = await client.get<PortalStorageSpaceShare[]>(projectPath);
    return data;
  }
  const { data } = await client.get<PortalStorageSpaceShare[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function listPortalShareCandidates(
  accountId: S3AccountSelector,
  options?: { targetAccountId?: number | string | null }
): Promise<PortalStorageSpaceShareCandidate[]> {
  const projectPath = portalProjectPath(accountId, "/share-candidates");
  if (projectPath) {
    const params = options?.targetAccountId != null ? { account_id: options.targetAccountId } : undefined;
    if (!params) {
      const { data } = await client.get<PortalStorageSpaceShareCandidate[]>(projectPath);
      return data;
    }
    const { data } = await client.get<PortalStorageSpaceShareCandidate[]>(projectPath, { params });
    return data;
  }
  const { data } = await client.get<PortalStorageSpaceShareCandidate[]>(
    "/portal/share-candidates",
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function listPortalStorageSpaceShareCandidates(
  accountId: S3AccountSelector,
  spaceId: string
): Promise<PortalStorageSpaceShareCandidate[]> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/share-candidates`);
  if (projectPath) {
    const { data } = await client.get<PortalStorageSpaceShareCandidate[]>(projectPath);
    return data;
  }
  const { data } = await client.get<PortalStorageSpaceShareCandidate[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/share-candidates`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function grantPortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: { email?: string; user_id?: number; role: PortalStorageSpaceRole }
): Promise<PortalStorageSpaceShare> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/shares`);
  if (projectPath) {
    const { data } = await client.post<PortalStorageSpaceShare>(projectPath, payload);
    return data;
  }
  const { data } = await client.post<PortalStorageSpaceShare>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updatePortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  userId: number,
  role: PortalStorageSpaceRole
): Promise<PortalStorageSpaceShare> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/shares/${userId}`);
  if (projectPath) {
    const { data } = await client.put<PortalStorageSpaceShare>(projectPath, { role });
    return data;
  }
  const { data } = await client.put<PortalStorageSpaceShare>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares/${userId}`,
    { role },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function revokePortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  userId: number
): Promise<PortalStorageSpaceShare[]> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/shares/${userId}`);
  if (projectPath) {
    const { data } = await client.delete<PortalStorageSpaceShare[]>(projectPath);
    return data;
  }
  const { data } = await client.delete<PortalStorageSpaceShare[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares/${userId}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function listPortalStorageSpacePublicLinks(
  accountId: S3AccountSelector,
  spaceId: string,
  options?: { objectKey?: string; includeRevoked?: boolean }
): Promise<PortalPublicLink[]> {
  const baseParams: Record<string, string | boolean> = {};
  if (options?.objectKey) {
    baseParams.object_key = options.objectKey;
  }
  if (options?.includeRevoked) {
    baseParams.include_revoked = true;
  }
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/public-links`);
  if (projectPath) {
    const { data } = await client.get<PortalPublicLink[]>(projectPath, { params: baseParams });
    return data;
  }
  const { data } = await client.get<PortalPublicLink[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/public-links`,
    { params: withS3AccountParam(baseParams, accountId) }
  );
  return data;
}

export async function createPortalStorageSpacePublicLink(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: { object_key: string; label?: string | null; expires_at?: string | null }
): Promise<PortalPublicLink> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/public-links`);
  if (projectPath) {
    const { data } = await client.post<PortalPublicLink>(projectPath, payload);
    return data;
  }
  const { data } = await client.post<PortalPublicLink>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/public-links`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function revokePortalStorageSpacePublicLink(
  accountId: S3AccountSelector,
  spaceId: string,
  linkId: number
): Promise<PortalPublicLink[]> {
  const projectPath = portalProjectPath(accountId, `/storage-spaces/${encodeURIComponent(spaceId)}/public-links/${linkId}`);
  if (projectPath) {
    const { data } = await client.delete<PortalPublicLink[]>(projectPath);
    return data;
  }
  const { data } = await client.delete<PortalPublicLink[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/public-links/${linkId}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function fetchPortalTraffic(
  accountId: S3AccountSelector,
  window: import("./stats").TrafficWindow,
  bucket?: string
): Promise<import("./stats").ManagerTrafficStats> {
  if (isPortalProjectSelector(accountId)) {
    return emptyPortalTraffic(window);
  }
  const baseParams: Record<string, string | number> = { window };
  if (bucket) {
    baseParams.bucket = bucket;
  }
  const params = withS3AccountParam(baseParams, accountId);
  const { data } = await client.get<import("./stats").ManagerTrafficStats>("/portal/traffic", { params });
  return data;
}

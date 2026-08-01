/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { LONG_RUNNING_REQUEST_TIMEOUT_MS, timeoutForRequestProfile } from "./client";
import { S3Account } from "./accounts";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import { PortalSettings, PortalSettingsOverride } from "./appSettings";
import type { BucketUsageStatsAggregateResponse } from "./bucketUsageStats";
import { resolveApiBaseUrl, streamBucketsWithSse } from "./sseBucketsStream";
import type { ManagerUsageTrendsResponse } from "./stats";
import type { UsageHistoryTrendResponse, UsageHistoryTrendWindow } from "./usageHistory";
import type { UserAvatarDescriptor } from "./users";
import type {
  StorageSpaceIconDescriptor,
  StorageSpaceIconPreset,
  StorageSpaceIconSource,
} from "./storageSpaceIcons";

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
  target_type?: "self" | "external";
  external_email?: string | null;
  storage_space_id?: string | null;
  storage_space_name?: string | null;
  bucket_name?: string | null;
  permission?: "read_only" | "read_write" | null;
};

export type PortalAccessKeyCreate = {
  target_type?: "self" | "external";
  storage_space_id?: string | null;
  external_email?: string | null;
  permission?: "read_only" | "read_write" | null;
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
  can_create_private_storage_spaces?: boolean;
  can_create_team_storage_spaces?: boolean;
  can_manage_portal_users?: boolean;
  allow_named_bucket_create?: boolean;
  server_access_logging_enabled?: boolean;
  storage_space_version_cleanup_enabled?: boolean;
};

export type PortalAccessKeysState = {
  iam_user: PortalIAMUser;
  s3_endpoint?: string | null;
  force_path_style?: boolean;
  access_keys: PortalAccessKey[];
  can_manage_access_keys: boolean;
  max_access_keys: number;
};

export type PortalUsage = {
  used_bytes?: number | null;
  used_objects?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  max_buckets?: number | null;
  storage_spaces?: PortalUsageStorageSpace[];
  other_storage_space?: PortalUsageStorageSpace | null;
};

export type PortalUsageStorageSpace = {
  id: string;
  name: string;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
};

export type PortalStorageSpaceRole = "Viewer" | "Editor" | "Owner" | "Manager";
export type PortalStorageSpaceGrantRole = "Viewer" | "Editor";
export type PortalStorageSpaceVisibility = "private" | "shared";
export type PortalStorageSpaceShareScope = "restricted" | "account";
export type PortalStorageSpaceAccountMemberRole = "Viewer" | "Editor";

export type PortalStorageSpaceCollaboratorPreview = {
  user_id: number;
  email: string;
  display_name?: string | null;
  role: PortalStorageSpaceRole;
  avatar?: UserAvatarDescriptor | null;
};

export type PortalStorageSpaceSummary = {
  id: string;
  name: string;
  role: PortalStorageSpaceRole;
  can_browse?: boolean | null;
  can_delete?: boolean;
  can_take_ownership?: boolean;
  status?: string | null;
  description?: string | null;
  owner_label?: string | null;
  owner_user_id?: number | null;
  collaborators?: PortalStorageSpaceCollaboratorPreview[];
  collaborator_count?: number;
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
  icon?: StorageSpaceIconDescriptor | null;
};

export type PortalStorageSpace = PortalStorageSpaceSummary;

export type PortalStorageSpaceInitialShare = {
  user_id: number;
  role: PortalStorageSpaceGrantRole;
};

export type PortalStorageSpaceCreate = {
  name: string;
  naming_mode?: "generic_uuid" | "named_bucket";
  description?: string | null;
  visibility?: PortalStorageSpaceVisibility;
  share_scope?: PortalStorageSpaceShareScope;
  account_member_role?: PortalStorageSpaceAccountMemberRole | null;
  initial_shares?: PortalStorageSpaceInitialShare[];
  project_key?: string | null;
  dataset_label?: string | null;
};

export type PortalStorageSpaceImport = {
  bucket_name: string;
  description?: string | null;
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

export type PortalStorageSpaceVersioningStatus = "Enabled" | "Suspended" | "Disabled";

export type PortalStorageObjectVersion = {
  key: string;
  version_id: string;
  is_latest: boolean;
  is_delete_marker: boolean;
  last_modified?: string | null;
  size?: number | null;
};

export type PortalStorageObjectVersionsResponse = {
  key: string;
  versioning_status: PortalStorageSpaceVersioningStatus;
  can_restore: boolean;
  versions: PortalStorageObjectVersion[];
  is_truncated: boolean;
  next_key_marker?: string | null;
  next_version_id_marker?: string | null;
};

export type PortalTrashItem = {
  key: string;
  name: string;
  deleted_at?: string | null;
  delete_marker_version_id: string;
  previous_version_id?: string | null;
  previous_last_modified?: string | null;
  size?: number | null;
};

export type PortalTrashResponse = {
  versioning_status: PortalStorageSpaceVersioningStatus;
  can_restore: boolean;
  items: PortalTrashItem[];
  is_truncated: boolean;
  next_key_marker?: string | null;
  next_version_id_marker?: string | null;
};

export type PortalStorageObjectRestoreResponse = {
  key: string;
  restored_from_version_id: string;
  message: string;
};

export type PortalDeletedPrefixRestoreFailure = {
  key: string;
  detail: string;
};

export type PortalDeletedPrefixRestoreProgress = {
  request_id?: string | null;
  stage: "prepare" | "list" | "restore" | "completed";
  storage_space_id: string;
  storage_space_name: string;
  prefix: string;
  scanned_versions: number;
  scanned_delete_markers: number;
  restore_candidates: number;
  restored_objects: number;
  failed_objects: number;
  total_candidates_final?: boolean;
  current_key?: string | null;
  message?: string | null;
};

export type PortalDeletedPrefixRestoreResult = {
  status: "completed" | "partial" | "canceled";
  storage_space_id: string;
  storage_space_name: string;
  prefix: string;
  scanned_versions: number;
  scanned_delete_markers: number;
  restore_candidates: number;
  restored_objects: number;
  failed_objects: number;
  failures: PortalDeletedPrefixRestoreFailure[];
  failures_truncated: boolean;
  started_at: string;
  finished_at: string;
};

export type PortalDeletedPrefixRestoreStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: PortalDeletedPrefixRestoreProgress) => void;
};

export type PortalStorageSpaceVersionCleanupProgress = {
  request_id?: string | null;
  stage: "prepare" | "list" | "delete" | "completed";
  storage_space_id: string;
  storage_space_name: string;
  scanned_versions: number;
  scanned_delete_markers: number;
  delete_candidates: number;
  deleted_versions: number;
  deleted_delete_markers: number;
  bytes_freed: number;
  total_candidates_final?: boolean;
  message?: string | null;
};

export type PortalStorageSpaceVersionCleanupResult = {
  status: "completed" | "failed" | "canceled";
  storage_space_id: string;
  storage_space_name: string;
  scanned_versions: number;
  scanned_delete_markers: number;
  deleted_versions: number;
  deleted_delete_markers: number;
  bytes_freed: number;
  started_at: string;
  finished_at: string;
};

export type PortalStorageSpaceVersionCleanupStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: PortalStorageSpaceVersionCleanupProgress) => void;
};

export type PortalServerAccessRawLogsDownload = {
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
  role: PortalStorageSpaceGrantRole;
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
  avatar?: UserAvatarDescriptor | null;
};

export type PortalStorageSpaceAccessSummary = {
  mode: "private" | "all" | "restricted";
  default_account_member_role?: PortalStorageSpaceAccountMemberRole | null;
  owner?: PortalStorageSpaceAccessPerson | null;
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
  avatar?: UserAvatarDescriptor | null;
};

export type PortalCollaborator = {
  user_id: number;
  email: string;
  display_name?: string | null;
  account_role: string;
  access_source: "direct" | "group" | "direct_and_group";
  member_since?: string | null;
  avatar?: UserAvatarDescriptor | null;
};

export type PortalCollaboratorTrend = {
  window: "month" | "week" | "day";
  label: string;
  period_start: string;
  collaborator_count: number;
};

export type PortalCollaboratorSummary = {
  collaborator_count: number;
  external_access_key_count: number;
  trend?: PortalCollaboratorTrend | null;
};

export type PortalCollaboratorsResponse = {
  summary: PortalCollaboratorSummary;
  collaborators: PortalCollaborator[];
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

export type PortalServerAccessLogMode = "transfers" | "operations";

export type PortalServerAccessRequesterIdentity = {
  label: string;
  kind: "portal_user" | "external_access" | "rgw_user" | "rgw_account" | "unknown";
  detail?: string | null;
  access_key_id?: string | null;
  iam_username?: string | null;
  user_id?: number | null;
  email?: string | null;
  resolved: boolean;
};

export type PortalServerAccessLogEntry = {
  id: string;
  source: "server_access_logging";
  timestamp: string;
  storage_space_id?: string | null;
  storage_space_name?: string | null;
  bucket_name: string;
  operation: string;
  operation_category: "upload" | "download" | "delete" | "metadata" | "list" | "other";
  object_key?: string | null;
  object_name?: string | null;
  direction?: "Upload" | "Download" | null;
  status_code?: number | null;
  error_code?: string | null;
  bytes_sent?: number | null;
  object_size?: number | null;
  requester?: string | null;
  requester_identity?: PortalServerAccessRequesterIdentity | null;
  client_ip?: string | null;
  auth_type?: string | null;
  request_id?: string | null;
  request_uri?: string | null;
  user_agent?: string | null;
  log_object_key: string;
};

export type PortalServerAccessLogPage = {
  entries: PortalServerAccessLogEntry[];
  total: number;
  limit: number;
  offset: number;
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

export async function listPortalAccounts(options?: { signal?: AbortSignal }): Promise<S3Account[]> {
  const { data } = await client.get<S3Account[]>("/portal/accounts", {
    signal: options?.signal,
    timeout: timeoutForRequestProfile("interactive"),
  });
  return data;
}

export async function fetchPortalState(accountId: S3AccountSelector): Promise<PortalState> {
  const { data } = await client.get<PortalState>("/portal/state", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function fetchPortalAccessKeysState(accountId: S3AccountSelector): Promise<PortalAccessKeysState> {
  const { data } = await client.get<PortalAccessKeysState>("/portal/access-keys", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function createPortalAccessKey(
  accountId: S3AccountSelector,
  payload?: PortalAccessKeyCreate
): Promise<PortalAccessKey> {
  const { data } = await client.post<PortalAccessKey>(
    "/portal/access-keys",
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updatePortalAccessKeyStatus(
  accountId: S3AccountSelector,
  accessKeyId: string,
  active: boolean
): Promise<PortalAccessKey> {
  const { data } = await client.put<PortalAccessKey>(
    `/portal/access-keys/${encodeURIComponent(accessKeyId)}/status`,
    { active },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deletePortalAccessKey(accountId: S3AccountSelector, accessKeyId: string): Promise<void> {
  await client.delete(`/portal/access-keys/${encodeURIComponent(accessKeyId)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function fetchPortalUsage(accountId: S3AccountSelector): Promise<PortalUsage> {
  const { data } = await client.get<PortalUsage>("/portal/usage", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function fetchPortalUsageTrends(accountId: S3AccountSelector): Promise<ManagerUsageTrendsResponse> {
  const { data } = await client.get<ManagerUsageTrendsResponse>("/portal/usage-trends", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function getPortalUsageStatsAggregate(
  accountId: S3AccountSelector
): Promise<BucketUsageStatsAggregateResponse> {
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
  const { data } = await client.get<UsageHistoryTrendResponse>(
    "/portal/usage-history-trends",
    { params: withS3AccountParam({ window }, accountId) }
  );
  return data;
}

export async function fetchPortalActivity(
  accountId: S3AccountSelector,
  options?: { spaceId?: string; limit?: number }
): Promise<PortalActivityItem[]> {
  const baseParams: Record<string, string | number> = {};
  if (options?.spaceId) baseParams.space_id = options.spaceId;
  if (options?.limit) baseParams.limit = options.limit;
  const { data } = await client.get<PortalActivityItem[]>("/portal/activity", {
    params: withS3AccountParam(baseParams, accountId),
  });
  return data;
}

export async function fetchPortalCollaborators(accountId: S3AccountSelector): Promise<PortalCollaboratorsResponse> {
  const { data } = await client.get<PortalCollaboratorsResponse>("/portal/collaborators", {
    params: withS3AccountParam(undefined, accountId),
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
  const { data } = await client.get<PortalTransfer[]>("/portal/transfers", {
    params: withS3AccountParam(baseParams, accountId),
  });
  return data;
}

export async function fetchPortalServerAccessLogs(
  accountId: S3AccountSelector,
  options: {
    date: string;
    mode?: PortalServerAccessLogMode;
    spaceId?: string;
    limit?: number;
    offset?: number;
    timezoneOffsetMinutes?: number;
    advancedFilter?: string;
  }
): Promise<PortalServerAccessLogEntry[]> {
  const baseParams: Record<string, string | number> = {
    date: options.date,
    mode: options.mode ?? "transfers",
    timezone_offset_minutes: options.timezoneOffsetMinutes ?? new Date().getTimezoneOffset(),
  };
  if (options.spaceId) baseParams.space_id = options.spaceId;
  if (options.limit) baseParams.limit = options.limit;
  if (options.offset) baseParams.offset = options.offset;
  if (options.advancedFilter) baseParams.advanced_filter = options.advancedFilter;
  const { data } = await client.get<PortalServerAccessLogEntry[]>("/portal/transfers/server-access-logs", {
    params: withS3AccountParam(baseParams, accountId),
  });
  return data;
}

export async function fetchPortalServerAccessLogPage(
  accountId: S3AccountSelector,
  options: {
    date: string;
    mode?: PortalServerAccessLogMode;
    spaceId?: string;
    limit?: number;
    offset?: number;
    timezoneOffsetMinutes?: number;
    advancedFilter?: string;
  }
): Promise<PortalServerAccessLogPage> {
  const baseParams: Record<string, string | number> = {
    date: options.date,
    mode: options.mode ?? "transfers",
    limit: options.limit ?? 200,
    offset: options.offset ?? 0,
    timezone_offset_minutes: options.timezoneOffsetMinutes ?? new Date().getTimezoneOffset(),
  };
  if (options.spaceId) baseParams.space_id = options.spaceId;
  if (options.advancedFilter) baseParams.advanced_filter = options.advancedFilter;
  const { data } = await client.get<PortalServerAccessLogPage>("/portal/transfers/server-access-logs/page", {
    params: withS3AccountParam(baseParams, accountId),
  });
  return data;
}

export async function downloadPortalServerAccessRawLogs(
  accountId: S3AccountSelector,
  options: {
    dateFrom: string;
    dateTo: string;
    spaceId?: string;
    timezoneOffsetMinutes?: number;
  }
): Promise<PortalServerAccessRawLogsDownload> {
  const baseParams: Record<string, string | number> = {
    date_from: options.dateFrom,
    date_to: options.dateTo,
    timezone_offset_minutes: options.timezoneOffsetMinutes ?? new Date().getTimezoneOffset(),
  };
  if (options.spaceId) baseParams.space_id = options.spaceId;
  const response = await client.get<Blob>("/portal/transfers/server-access-logs/raw", {
    params: withS3AccountParam(baseParams, accountId),
    responseType: "blob",
    timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
  });
  const fallback =
    options.dateFrom === options.dateTo
      ? `portal-server-access-logs-${options.dateFrom}.log`
      : `portal-server-access-logs-${options.dateFrom}-${options.dateTo}.log`;
  return {
    blob: response.data,
    filename: filenameFromContentDisposition(response.headers?.["content-disposition"], fallback),
  };
}

export async function fetchPortalAlerts(accountId: S3AccountSelector, limit = 50): Promise<PortalAlert[]> {
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
  const { data } = await client.get<PortalStorageSpaceSummary[]>("/portal/storage-spaces", {
    params: withS3AccountParam(baseParams, accountId),
  });
  return data;
}

export async function createPortalStorageSpace(
  accountId: S3AccountSelector,
  payload: PortalStorageSpaceCreate
): Promise<PortalStorageSpace> {
  const { data } = await client.post<PortalStorageSpace>("/portal/storage-spaces", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function importPortalStorageSpace(
  accountId: S3AccountSelector,
  payload: PortalStorageSpaceImport
): Promise<PortalStorageSpace> {
  const { data } = await client.post<PortalStorageSpace>("/portal/storage-spaces/import", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchPortalStorageSpace(
  accountId: S3AccountSelector,
  spaceId: string
): Promise<PortalStorageSpace> {
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
  const { data } = await client.patch<PortalStorageSpace>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updatePortalStorageSpaceIcon(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: { source: StorageSpaceIconSource; preset?: StorageSpaceIconPreset | null }
): Promise<StorageSpaceIconDescriptor> {
  const { data } = await client.put<StorageSpaceIconDescriptor>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/icon`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function uploadPortalStorageSpaceIcon(
  accountId: S3AccountSelector,
  spaceId: string,
  file: File
): Promise<StorageSpaceIconDescriptor> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await client.put<StorageSpaceIconDescriptor>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/icon/image`,
    formData,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function takePortalStorageSpaceOwnership(
  accountId: S3AccountSelector,
  spaceId: string
): Promise<PortalStorageSpace> {
  const { data } = await client.post<PortalStorageSpace>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/take-ownership`,
    undefined,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deletePortalStorageSpace(
  accountId: S3AccountSelector,
  spaceId: string
): Promise<void> {
  await client.delete(`/portal/storage-spaces/${encodeURIComponent(spaceId)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function fetchPortalStorageSpaceAccessSummary(
  accountId: S3AccountSelector,
  spaceId: string
): Promise<PortalStorageSpaceAccessSummary> {
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
  const { data } = await client.get<PortalStorageObjectDetail>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects/detail`,
    { params: withS3AccountParam({ key }, accountId) }
  );
  return data;
}

export async function fetchPortalStorageSpaceObjectVersions(
  accountId: S3AccountSelector,
  spaceId: string,
  key: string,
  markers?: {
    keyMarker?: string | null;
    versionIdMarker?: string | null;
  }
): Promise<PortalStorageObjectVersionsResponse> {
  const { data } = await client.get<PortalStorageObjectVersionsResponse>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects/versions`,
    {
      params: withS3AccountParam(
        {
          key,
          ...(markers?.keyMarker ? { key_marker: markers.keyMarker } : {}),
          ...(markers?.versionIdMarker
            ? { version_id_marker: markers.versionIdMarker }
            : {}),
        },
        accountId
      ),
    }
  );
  return data;
}

export async function fetchPortalStorageSpaceTrash(
  accountId: S3AccountSelector,
  spaceId: string,
  markers?: {
    keyMarker?: string | null;
    versionIdMarker?: string | null;
  }
): Promise<PortalTrashResponse> {
  const { data } = await client.get<PortalTrashResponse>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/trash`,
    {
      params: withS3AccountParam(
        {
          ...(markers?.keyMarker ? { key_marker: markers.keyMarker } : {}),
          ...(markers?.versionIdMarker
            ? { version_id_marker: markers.versionIdMarker }
            : {}),
        },
        accountId
      ),
    }
  );
  return data;
}

export async function restorePortalStorageSpaceObject(
  accountId: S3AccountSelector,
  spaceId: string,
  key: string,
  versionId?: string | null
): Promise<PortalStorageObjectRestoreResponse> {
  const { data } = await client.post<PortalStorageObjectRestoreResponse>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects/restore`,
    {
      key,
      ...(versionId ? { version_id: versionId } : {}),
    },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export function streamPortalDeletedPrefixRestore(
  accountId: S3AccountSelector,
  spaceId: string,
  prefix: string,
  options?: PortalDeletedPrefixRestoreStreamOptions
): Promise<PortalDeletedPrefixRestoreResult> {
  const baseUrl = resolveApiBaseUrl();
  const queryParams = withS3AccountParam(undefined, accountId) ?? {};
  const query = new URLSearchParams();
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return streamBucketsWithSse<
    PortalDeletedPrefixRestoreProgress,
    PortalDeletedPrefixRestoreResult
  >({
    url: `${baseUrl}/portal/storage-spaces/${encodeURIComponent(spaceId)}/trash/restore-prefix/stream${suffix}`,
    options,
    requestInit: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix }),
    },
    streamFailedLabel: "Deleted folder restoration stream failed",
    missingResultMessage:
      "Deleted folder restoration stream ended without a result payload",
  });
}

export async function deletePortalStorageSpaceObject(
  accountId: S3AccountSelector,
  spaceId: string,
  key: string
): Promise<void> {
  await client.delete(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects`,
    { params: withS3AccountParam({ key }, accountId) }
  );
}

export function portalStorageSpaceVersionCleanupConfirmationPhrase(spaceName: string): string {
  return `CLEAN HISTORY ${spaceName.toUpperCase()}`;
}

function buildPortalVersionCleanupPostInit(payload: { confirmation: string }): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

export function streamPortalStorageSpaceVersionCleanup(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: { confirmation: string },
  options?: PortalStorageSpaceVersionCleanupStreamOptions
): Promise<PortalStorageSpaceVersionCleanupResult> {
  const baseUrl = resolveApiBaseUrl();
  const queryParams = withS3AccountParam(undefined, accountId) ?? {};
  const query = new URLSearchParams();
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return streamBucketsWithSse<
    PortalStorageSpaceVersionCleanupProgress,
    PortalStorageSpaceVersionCleanupResult
  >({
    url: `${baseUrl}/portal/storage-spaces/${encodeURIComponent(spaceId)}/versions/cleanup/stream${suffix}`,
    options,
    requestInit: buildPortalVersionCleanupPostInit(payload),
    streamFailedLabel: "Storage Space history cleanup stream failed",
    missingResultMessage: "Storage Space history cleanup stream ended without a result payload",
  });
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
  key: string,
  signal?: AbortSignal
): Promise<PortalStorageObjectDownload> {
  const response = await client.get<Blob>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects/download`,
    {
      params: withS3AccountParam({ key }, accountId),
      responseType: "blob",
      ...(signal ? { signal } : {}),
      timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
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
  const { data } = await client.get<PortalStorageSpaceShare[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function listPortalShareCandidates(
  accountId: S3AccountSelector
): Promise<PortalStorageSpaceShareCandidate[]> {
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
  const { data } = await client.get<PortalStorageSpaceShareCandidate[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/share-candidates`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function grantPortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: { email?: string; user_id?: number; role: PortalStorageSpaceGrantRole }
): Promise<PortalStorageSpaceShare> {
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
  role: PortalStorageSpaceGrantRole
): Promise<PortalStorageSpaceShare> {
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
  const baseParams: Record<string, string | number> = { window };
  if (bucket) {
    baseParams.bucket = bucket;
  }
  const params = withS3AccountParam(baseParams, accountId);
  const { data } = await client.get<import("./stats").ManagerTrafficStats>("/portal/traffic", { params });
  return data;
}

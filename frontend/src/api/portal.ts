/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { Bucket } from "./buckets";
import { S3Account } from "./accounts";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import { PortalSettings, PortalSettingsOverride, PortalSettingsOverridePolicy } from "./appSettings";
import type { ManagerUsageTrendsResponse } from "./stats";

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
  buckets: Bucket[];
  total_buckets?: number | null;
  max_buckets?: number | null;
  s3_endpoint?: string | null;
  used_bytes?: number | null;
  used_objects?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  just_created?: boolean;
  account_role?: string | null;
  can_manage_buckets?: boolean;
  can_manage_portal_users?: boolean;
  allow_named_bucket_create?: boolean;
};

export type PortalUsage = {
  used_bytes?: number | null;
  used_objects?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  storage_spaces?: PortalUsageStorageSpace[];
};

export type PortalUsageStorageSpace = {
  id: string;
  name: string;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
};

export type PortalStorageSpaceRole = "Viewer" | "Editor" | "Owner";

export type PortalStorageSpaceSummary = {
  id: string;
  name: string;
  role: PortalStorageSpaceRole;
  status?: string | null;
  description?: string | null;
  owner_label?: string | null;
  space_type?: string | null;
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
  origin?: "legacy" | "portal_generic" | "portal_named" | "imported";
  name_editable?: boolean;
};

export type PortalStorageSpace = PortalStorageSpaceSummary;

export type PortalStorageSpaceCreate = {
  name: string;
  naming_mode?: "generic_uuid" | "named_bucket";
  description?: string | null;
  owner_label?: string | null;
  space_type?: string | null;
  project_key?: string | null;
  dataset_label?: string | null;
};

export type PortalStorageSpaceImport = {
  bucket_name: string;
  description?: string | null;
  owner_label?: string | null;
  space_type?: string | null;
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
  portal_manager_override: PortalSettingsOverride;
  override_policy: PortalSettingsOverridePolicy;
};

export async function listPortalAccounts(): Promise<S3Account[]> {
  const { data } = await client.get<S3Account[]>("/portal/accounts");
  return data;
}

export async function fetchPortalState(accountId: S3AccountSelector): Promise<PortalState> {
  const { data } = await client.get<PortalState>("/portal/state", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function fetchPortalUsage(accountId: S3AccountSelector): Promise<PortalUsage> {
  const { data } = await client.get<PortalUsage>("/portal/usage", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function fetchPortalUsageTrends(accountId: S3AccountSelector): Promise<ManagerUsageTrendsResponse> {
  const { data } = await client.get<ManagerUsageTrendsResponse>("/portal/usage-trends", { params: withS3AccountParam(undefined, accountId) });
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
  const response = await client.get<Blob>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects/download`,
    {
      params: withS3AccountParam({ key }, accountId),
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
  const { data } = await client.get<PortalStorageSpaceShare[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function grantPortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: { email?: string; user_id?: number; role: PortalStorageSpaceRole }
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
  role: PortalStorageSpaceRole
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

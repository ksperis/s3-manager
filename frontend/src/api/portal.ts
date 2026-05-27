/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { Bucket } from "./buckets";
import { S3Account } from "./accounts";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import { PortalSettings, PortalSettingsOverride, PortalSettingsOverridePolicy } from "./appSettings";

export type PortalAccountRole = "portal_user" | "portal_manager" | "portal_none";

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
  s3_endpoint?: string | null;
  used_bytes?: number | null;
  used_objects?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  just_created?: boolean;
  account_role?: string | null;
  can_manage_buckets?: boolean;
  can_manage_portal_users?: boolean;
};

export type PortalUsage = {
  used_bytes?: number | null;
  used_objects?: number | null;
};

export type PortalStorageSpaceRole = "Viewer" | "Editor" | "Owner";

export type PortalStorageSpaceSummary = {
  id: string;
  name: string;
  role: PortalStorageSpaceRole;
  status?: string | null;
  region?: string | null;
  created_at?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  internal_bucket_name?: string | null;
};

export type PortalStorageSpace = PortalStorageSpaceSummary & {
  description?: string | null;
};

export type PortalStorageObject = {
  key: string;
  name: string;
  size?: number | null;
  last_modified?: string | null;
};

export type PortalStorageObjectListing = {
  prefix: string;
  objects: PortalStorageObject[];
  prefixes: string[];
  is_truncated?: boolean;
  next_continuation_token?: string | null;
};

export type PortalStorageObjectUploadResponse = {
  key: string;
  message: string;
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

export type PortalUserSummary = {
  id: number | null;
  email: string;
  role?: string | null;
  iam_username?: string | null;
  iam_only?: boolean | null;
};

export type PortalUserBuckets = {
  buckets: string[];
};

export type PortalIamComplianceIssue = {
  scope: string;
  subject: string;
  message: string;
};

export type PortalIamComplianceReport = {
  ok: boolean;
  issues: PortalIamComplianceIssue[];
};

export type PortalAccountSettings = {
  effective: PortalSettings;
  admin_override: PortalSettingsOverride;
  portal_manager_override: PortalSettingsOverride;
  override_policy: PortalSettingsOverridePolicy;
};

export type PortalBucketStats = {
  name: string;
  used_bytes?: number | null;
  object_count?: number | null;
};

export async function listPortalAccounts(): Promise<S3Account[]> {
  const { data } = await client.get<S3Account[]>("/portal/accounts");
  return data;
}

export async function fetchPortalState(accountId: S3AccountSelector): Promise<PortalState> {
  const { data } = await client.get<PortalState>("/portal/state", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function bootstrapPortalIdentity(accountId: S3AccountSelector): Promise<PortalState> {
  const { data } = await client.post<PortalState>("/portal/bootstrap", undefined, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchPortalUsage(accountId: S3AccountSelector): Promise<PortalUsage> {
  const { data } = await client.get<PortalUsage>("/portal/usage", { params: withS3AccountParam(undefined, accountId) });
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

export async function listPortalBuckets(
  accountId: S3AccountSelector,
  options?: { search?: string }
): Promise<Bucket[]> {
  const baseParams: Record<string, string> = {};
  if (options?.search) {
    baseParams.search = options.search;
  }
  const { data } = await client.get<Bucket[]>("/portal/buckets", { params: withS3AccountParam(baseParams, accountId) });
  return data;
}

export async function listPortalStorageSpaces(
  accountId: S3AccountSelector,
  options?: { search?: string }
): Promise<PortalStorageSpaceSummary[]> {
  const baseParams: Record<string, string> = {};
  if (options?.search) {
    baseParams.search = options.search;
  }
  const { data } = await client.get<PortalStorageSpaceSummary[]>("/portal/storage-spaces", {
    params: withS3AccountParam(baseParams, accountId),
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

export async function listPortalStorageSpaceObjects(
  accountId: S3AccountSelector,
  spaceId: string,
  options?: { prefix?: string; continuationToken?: string; maxKeys?: number }
): Promise<PortalStorageObjectListing> {
  const baseParams: Record<string, string | number> = {};
  if (options?.prefix) {
    baseParams.prefix = options.prefix;
  }
  if (options?.continuationToken) {
    baseParams.continuation_token = options.continuationToken;
  }
  if (options?.maxKeys) {
    baseParams.max_keys = options.maxKeys;
  }
  const { data } = await client.get<PortalStorageObjectListing>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects`,
    { params: withS3AccountParam(baseParams, accountId) }
  );
  return data;
}

export async function uploadPortalStorageSpaceObject(
  accountId: S3AccountSelector,
  spaceId: string,
  file: File,
  options?: { prefix?: string; key?: string }
): Promise<PortalStorageObjectUploadResponse> {
  const payload = new FormData();
  payload.append("file", file);
  if (options?.prefix) {
    payload.append("prefix", options.prefix);
  }
  if (options?.key) {
    payload.append("key", options.key);
  }
  const { data } = await client.post<PortalStorageObjectUploadResponse>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/objects/upload`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
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

export async function fetchPortalBucketStats(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<PortalBucketStats> {
  const { data } = await client.get<PortalBucketStats>(`/portal/buckets/${encodeURIComponent(bucketName)}/stats`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function listPortalBucketUsers(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<PortalUserSummary[]> {
  const { data } = await client.get<PortalUserSummary[]>(
    `/portal/buckets/${encodeURIComponent(bucketName)}/users`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function createPortalBucket(
  accountId: S3AccountSelector,
  name: string,
  options?: { versioning?: boolean }
): Promise<Bucket> {
  const payload: Record<string, unknown> = { name };
  if (options?.versioning !== undefined) {
    payload.versioning = options.versioning;
  }
  const { data } = await client.post<Bucket>("/portal/buckets", payload, { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function deletePortalBucket(
  accountId: S3AccountSelector,
  bucketName: string,
  force = false
): Promise<void> {
  await client.delete(`/portal/buckets/${encodeURIComponent(bucketName)}`, {
    params: withS3AccountParam({ force }, accountId),
  });
}

export async function createPortalAccessKey(accountId: S3AccountSelector): Promise<PortalAccessKey> {
  const { data } = await client.post<PortalAccessKey>("/portal/access-keys", undefined, {
    params: withS3AccountParam(undefined, accountId),
  });
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

export async function listPortalUsers(accountId: S3AccountSelector): Promise<PortalUserSummary[]> {
  const { data } = await client.get<PortalUserSummary[]>("/portal/users", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function addPortalUser(accountId: S3AccountSelector, email: string): Promise<PortalUserSummary> {
  const { data } = await client.post<PortalUserSummary>(
    "/portal/users",
    { email },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deletePortalUser(accountId: S3AccountSelector, userId: number): Promise<void> {
  await client.delete(`/portal/users/${userId}`, { params: withS3AccountParam(undefined, accountId) });
}

export async function updatePortalUserRole(
  accountId: S3AccountSelector,
  userId: number,
  accountRole: PortalAccountRole
): Promise<PortalUserSummary> {
  const { data } = await client.put<PortalUserSummary>(
    `/portal/users/${userId}`,
    { account_role: accountRole },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function listPortalUserBuckets(accountId: S3AccountSelector, userId: number): Promise<PortalUserBuckets> {
  const { data } = await client.get<PortalUserBuckets>(`/portal/users/${userId}/buckets`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function grantPortalUserBucket(
  accountId: S3AccountSelector,
  userId: number,
  bucket: string
): Promise<PortalUserBuckets> {
  const { data } = await client.post<PortalUserBuckets>(
    `/portal/users/${userId}/buckets`,
    { bucket },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function revokePortalUserBucket(
  accountId: S3AccountSelector,
  userId: number,
  bucket: string
): Promise<PortalUserBuckets> {
  const { data } = await client.delete<PortalUserBuckets>(
    `/portal/users/${userId}/buckets/${encodeURIComponent(bucket)}`,
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

export async function fetchPortalSettings(accountId: S3AccountSelector): Promise<PortalSettings> {
  const { data } = await client.get<PortalSettings>("/portal/settings", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchPortalAccountSettings(accountId: S3AccountSelector): Promise<PortalAccountSettings> {
  const { data } = await client.get<PortalAccountSettings>("/portal/account-settings", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function updatePortalAccountSettings(
  accountId: S3AccountSelector,
  payload: PortalSettingsOverride
): Promise<PortalAccountSettings> {
  const { data } = await client.put<PortalAccountSettings>("/portal/account-settings", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchPortalIamCompliance(accountId: S3AccountSelector): Promise<PortalIamComplianceReport> {
  const { data } = await client.get<PortalIamComplianceReport>("/portal/iam-compliance", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function applyPortalIamCompliance(accountId: S3AccountSelector): Promise<PortalIamComplianceReport> {
  const { data } = await client.post<PortalIamComplianceReport>(
    "/portal/iam-compliance/apply",
    undefined,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

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

export async function listPortalAccessKeys(accountId: S3AccountSelector): Promise<PortalAccessKey[]> {
  const { data } = await client.get<PortalAccessKey[]>("/portal/access-keys", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function createPortalAccessKey(accountId: S3AccountSelector): Promise<PortalAccessKey> {
  const { data } = await client.post<PortalAccessKey>("/portal/access-keys", undefined, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function rotatePortalAccessKey(accountId: S3AccountSelector): Promise<PortalAccessKey> {
  const { data } = await client.post<PortalAccessKey>("/portal/access-keys/portal/rotate", undefined, {
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

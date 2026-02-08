/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { PaginatedResponse } from "./types";
import type {
  BucketFeatureStatus,
  BucketLoggingConfiguration,
  BucketNotificationConfiguration,
  BucketQuotaUpdate,
  BucketTag,
  BucketWebsiteConfiguration,
} from "./buckets";

export type CephAdminEndpoint = {
  id: number;
  name: string;
  endpoint_url: string;
  admin_endpoint?: string | null;
  region?: string | null;
  is_default: boolean;
  capabilities?: Record<string, boolean>;
};

export type CephAdminRgwAccount = {
  account_id: string;
  account_name?: string | null;
};

export type PaginatedCephAdminAccountsResponse = PaginatedResponse<CephAdminRgwAccount>;

export type ListCephAdminAccountsParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
};

export async function listCephAdminEndpoints(): Promise<CephAdminEndpoint[]> {
  const { data } = await client.get<CephAdminEndpoint[]>("/ceph-admin/endpoints");
  return data;
}

export async function listCephAdminAccounts(
  endpointId: number,
  params?: ListCephAdminAccountsParams
): Promise<PaginatedCephAdminAccountsResponse> {
  const { data } = await client.get<PaginatedCephAdminAccountsResponse>(`/ceph-admin/endpoints/${endpointId}/accounts`, {
    params,
  });
  return data;
}

export type CephAdminRgwUser = {
  uid: string;
  tenant?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  suspended?: boolean | null;
  max_buckets?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
};

export type CephAdminAssumeUserResponse = {
  context_id: string;
  expires_at: string;
};

export type PaginatedCephAdminUsersResponse = PaginatedResponse<CephAdminRgwUser>;

export type ListCephAdminUsersParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include?: string[];
};

export async function listCephAdminUsers(
  endpointId: number,
  params?: ListCephAdminUsersParams
): Promise<PaginatedCephAdminUsersResponse> {
  const { data } = await client.get<PaginatedCephAdminUsersResponse>(`/ceph-admin/endpoints/${endpointId}/users`, {
    params: {
      ...params,
      include: params?.include?.join(","),
    },
  });
  return data;
}

export async function assumeCephAdminUser(endpointId: number, uid: string): Promise<CephAdminAssumeUserResponse> {
  const { data } = await client.post<CephAdminAssumeUserResponse>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/assume`
  );
  return data;
}

export type CephAdminBucket = {
  name: string;
  tenant?: string | null;
  owner?: string | null;
  owner_name?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  tags?: BucketTag[] | null;
  features?: Record<string, BucketFeatureStatus> | null;
};

export type PaginatedCephAdminBucketsResponse = PaginatedResponse<CephAdminBucket>;

export type ListCephAdminBucketsParams = {
  page?: number;
  page_size?: number;
  filter?: string;
  advanced_filter?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include?: string[];
  with_stats?: boolean;
};

export async function listCephAdminBuckets(
  endpointId: number,
  params?: ListCephAdminBucketsParams
): Promise<PaginatedCephAdminBucketsResponse> {
  const { data } = await client.get<PaginatedCephAdminBucketsResponse>(`/ceph-admin/endpoints/${endpointId}/buckets`, {
    params: {
      ...params,
      include: params?.include?.join(","),
    },
  });
  return data;
}

export type BucketLifecycleConfig = { rules: Record<string, unknown>[] };
export type BucketCors = { rules: Record<string, unknown>[] };
export type BucketPolicy = { policy: Record<string, unknown> | null };
export type BucketTag = { key: string; value: string };

export type BucketObjectLockConfiguration = {
  enabled?: boolean | null;
  mode?: string | null;
  days?: number | null;
  years?: number | null;
};

export type BucketPublicAccessBlock = {
  block_public_acls?: boolean | null;
  ignore_public_acls?: boolean | null;
  block_public_policy?: boolean | null;
  restrict_public_buckets?: boolean | null;
};

export type BucketLifecycleRule = {
  id?: string | null;
  status?: string | null;
  prefix?: string | null;
};

export type BucketProperties = {
  versioning_status?: string | null;
  object_lock_enabled?: boolean | null;
  object_lock?: BucketObjectLockConfiguration | null;
  public_access_block?: BucketPublicAccessBlock | null;
  lifecycle_rules: BucketLifecycleRule[];
  cors_rules?: Record<string, unknown>[] | null;
};

export async function getCephAdminBucketProperties(endpointId: number, bucketName: string): Promise<BucketProperties> {
  const { data } = await client.get<BucketProperties>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/properties`
  );
  return data;
}

export async function setCephAdminBucketVersioning(endpointId: number, bucketName: string, enabled: boolean): Promise<void> {
  await client.put(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/versioning`, { enabled });
}

export async function getCephAdminBucketLifecycle(endpointId: number, bucketName: string): Promise<BucketLifecycleConfig> {
  const { data } = await client.get<BucketLifecycleConfig>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/lifecycle`
  );
  return data;
}

export async function putCephAdminBucketLifecycle(endpointId: number, bucketName: string, rules: Record<string, unknown>[]): Promise<BucketLifecycleConfig> {
  const { data } = await client.put<BucketLifecycleConfig>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/lifecycle`,
    { rules }
  );
  return data;
}

export async function deleteCephAdminBucketLifecycle(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/lifecycle`);
}

export async function getCephAdminBucketCors(endpointId: number, bucketName: string): Promise<BucketCors> {
  const { data } = await client.get<BucketCors>(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/cors`);
  return data;
}

export async function putCephAdminBucketCors(endpointId: number, bucketName: string, rules: Record<string, unknown>[]): Promise<BucketCors> {
  const { data } = await client.put<BucketCors>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/cors`,
    { rules }
  );
  return data;
}

export async function deleteCephAdminBucketCors(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/cors`);
}

export async function getCephAdminBucketPolicy(endpointId: number, bucketName: string): Promise<BucketPolicy> {
  const { data } = await client.get<BucketPolicy>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/policy`
  );
  return data;
}

export async function putCephAdminBucketPolicy(endpointId: number, bucketName: string, policy: Record<string, unknown>): Promise<BucketPolicy> {
  const { data } = await client.put<BucketPolicy>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/policy`,
    { policy }
  );
  return data;
}

export async function deleteCephAdminBucketPolicy(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/policy`);
}

export async function getCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.get<BucketNotificationConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/notifications`
  );
  return data;
}

export async function putCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
  configuration: Record<string, unknown>
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.put<BucketNotificationConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/notifications`,
    { configuration }
  );
  return data;
}

export async function deleteCephAdminBucketNotifications(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/notifications`);
}

export async function getCephAdminBucketLogging(
  endpointId: number,
  bucketName: string
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.get<BucketLoggingConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/logging`
  );
  return data;
}

export async function putCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
  payload: BucketLoggingConfiguration
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.put<BucketLoggingConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/logging`,
    payload
  );
  return data;
}

export async function deleteCephAdminBucketLogging(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/logging`);
}

export async function getCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string
): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.get<BucketWebsiteConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/website`
  );
  return data;
}

export async function putCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
  payload: BucketWebsiteConfiguration
): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.put<BucketWebsiteConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/website`,
    payload
  );
  return data;
}

export async function deleteCephAdminBucketWebsite(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/website`);
}

export async function getCephAdminBucketTags(endpointId: number, bucketName: string): Promise<{ tags: BucketTag[] }> {
  const { data } = await client.get<{ tags: BucketTag[] }>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/tags`
  );
  return data;
}

export async function putCephAdminBucketTags(endpointId: number, bucketName: string, tags: BucketTag[]): Promise<void> {
  await client.put(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/tags`, { tags });
}

export async function deleteCephAdminBucketTags(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/tags`);
}

export type BucketAclGrantee = {
  type: string;
  id?: string | null;
  display_name?: string | null;
  uri?: string | null;
};

export type BucketAclGrant = {
  grantee: BucketAclGrantee;
  permission: string;
};

export type BucketAcl = {
  owner?: string | null;
  grants: BucketAclGrant[];
};

export async function getCephAdminBucketAcl(endpointId: number, bucketName: string): Promise<BucketAcl> {
  const { data } = await client.get<BucketAcl>(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/acl`);
  return data;
}

export async function updateCephAdminBucketAcl(endpointId: number, bucketName: string, acl: string): Promise<BucketAcl> {
  const { data } = await client.put<BucketAcl>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/acl`,
    { acl }
  );
  return data;
}

export async function getCephAdminBucketPublicAccessBlock(endpointId: number, bucketName: string): Promise<BucketPublicAccessBlock> {
  const { data } = await client.get<BucketPublicAccessBlock>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/public-access-block`
  );
  return data;
}

export async function updateCephAdminBucketPublicAccessBlock(
  endpointId: number,
  bucketName: string,
  payload: BucketPublicAccessBlock
): Promise<BucketPublicAccessBlock> {
  const { data } = await client.put<BucketPublicAccessBlock>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/public-access-block`,
    payload
  );
  return data;
}

export async function getCephAdminBucketObjectLock(endpointId: number, bucketName: string): Promise<BucketObjectLockConfiguration> {
  const { data } = await client.get<BucketObjectLockConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/object-lock`
  );
  return data;
}

export async function updateCephAdminBucketObjectLock(
  endpointId: number,
  bucketName: string,
  payload: BucketObjectLockConfiguration
): Promise<BucketObjectLockConfiguration> {
  const { data } = await client.put<BucketObjectLockConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/object-lock`,
    payload
  );
  return data;
}

export async function updateCephAdminBucketQuota(
  endpointId: number,
  bucketName: string,
  payload: BucketQuotaUpdate
): Promise<void> {
  await client.put(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/quota`, payload);
}

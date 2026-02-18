/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type BucketFeatureTone = "active" | "inactive" | "unknown";
export type BucketFeatureStatus = { state: string; tone: BucketFeatureTone };

export type Bucket = {
  name: string;
  creation_date?: string;
  owner?: string | null;
  owner_name?: string | null;
  used_bytes?: number;
  object_count?: number;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  tags?: BucketTag[] | null;
  features?: Record<string, BucketFeatureStatus> | null;
};

export async function listBuckets(
  accountId: S3AccountSelector,
  options?: { include?: string[]; with_stats?: boolean }
): Promise<Bucket[]> {
  const { data } = await client.get<Bucket[]>("/manager/buckets", {
    params: withS3AccountParam(
      {
        include: options?.include?.join(","),
        with_stats: options?.with_stats,
      },
      accountId
    ),
  });
  return data;
}

type CreateBucketOptions = {
  versioning?: boolean;
  locationConstraint?: string;
};

export async function createBucket(name: string, accountId: S3AccountSelector, options?: CreateBucketOptions): Promise<void> {
  const locationConstraint = options?.locationConstraint?.trim();
  await client.post(
    "/manager/buckets",
    {
      name,
      versioning: options?.versioning ?? false,
      location_constraint: locationConstraint || undefined,
    },
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function deleteBucket(name: string, accountId: S3AccountSelector, force = false): Promise<void> {
  await client.delete(`/manager/buckets/${encodeURIComponent(name)}`, { params: withS3AccountParam({ force }, accountId) });
}

export type BucketLifecycleRule = {
  id?: string | null;
  status?: string | null;
  prefix?: string | null;
};

export type BucketLifecycleConfig = {
  rules: Record<string, unknown>[];
};

export type BucketTag = { key: string; value: string };

export type BucketObjectLockConfiguration = {
  enabled?: boolean | null;
  mode?: string | null;
  days?: number | null;
  years?: number | null;
};

export type BucketNotificationConfiguration = {
  configuration: Record<string, unknown>;
};

export type BucketLoggingConfiguration = {
  enabled?: boolean | null;
  target_bucket?: string | null;
  target_prefix?: string | null;
};

export type BucketPublicAccessBlock = {
  block_public_acls?: boolean | null;
  ignore_public_acls?: boolean | null;
  block_public_policy?: boolean | null;
  restrict_public_buckets?: boolean | null;
};

export type BucketWebsiteRedirectAllRequestsTo = {
  host_name: string;
  protocol?: string | null;
};

export type BucketWebsiteConfiguration = {
  index_document?: string | null;
  error_document?: string | null;
  redirect_all_requests_to?: BucketWebsiteRedirectAllRequestsTo | null;
  routing_rules?: Record<string, unknown>[];
};

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

export type BucketProperties = {
  versioning_status?: string | null;
  object_lock_enabled?: boolean | null;
  object_lock?: BucketObjectLockConfiguration | null;
  public_access_block?: BucketPublicAccessBlock | null;
  lifecycle_rules: BucketLifecycleRule[];
  cors_rules?: Record<string, unknown>[] | null;
};

export async function getBucketProperties(accountId: S3AccountSelector, bucketName: string): Promise<BucketProperties> {
  const { data } = await client.get<BucketProperties>(`/manager/buckets/${encodeURIComponent(bucketName)}/properties`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function getBucketAcl(accountId: S3AccountSelector, bucketName: string): Promise<BucketAcl> {
  const { data } = await client.get<BucketAcl>(`/manager/buckets/${encodeURIComponent(bucketName)}/acl`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function updateBucketAcl(accountId: S3AccountSelector, bucketName: string, acl: string): Promise<BucketAcl> {
  const { data } = await client.put<BucketAcl>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/acl`,
    { acl },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function getBucketPublicAccessBlock(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<BucketPublicAccessBlock> {
  const { data } = await client.get<BucketPublicAccessBlock>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/public-access-block`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updateBucketPublicAccessBlock(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: BucketPublicAccessBlock
): Promise<BucketPublicAccessBlock> {
  const { data } = await client.put<BucketPublicAccessBlock>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/public-access-block`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function setBucketVersioning(accountId: S3AccountSelector, bucketName: string, enabled: boolean): Promise<void> {
  await client.put(
    `/manager/buckets/${encodeURIComponent(bucketName)}/versioning`,
    { enabled },
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export type BucketPolicy = { policy: Record<string, unknown> | null };

export async function getBucketPolicy(accountId: S3AccountSelector, bucketName: string): Promise<BucketPolicy> {
  const { data } = await client.get<BucketPolicy>(`/manager/buckets/${encodeURIComponent(bucketName)}/policy`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function putBucketPolicy(accountId: S3AccountSelector, bucketName: string, policy: Record<string, unknown>): Promise<BucketPolicy> {
  const { data } = await client.put<BucketPolicy>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/policy`,
    { policy },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketPolicyApi(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`/manager/buckets/${encodeURIComponent(bucketName)}/policy`, { params: withS3AccountParam(undefined, accountId) });
}

export async function getBucketLifecycle(accountId: S3AccountSelector, bucketName: string): Promise<BucketLifecycleConfig> {
  const { data } = await client.get<BucketLifecycleConfig>(`/manager/buckets/${encodeURIComponent(bucketName)}/lifecycle`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function putBucketLifecycle(
  accountId: S3AccountSelector,
  bucketName: string,
  rules: Record<string, unknown>[]
): Promise<BucketLifecycleConfig> {
  const { data } = await client.put<BucketLifecycleConfig>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/lifecycle`,
    { rules },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketLifecycle(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`/manager/buckets/${encodeURIComponent(bucketName)}/lifecycle`, { params: withS3AccountParam(undefined, accountId) });
}

export type BucketCors = { rules: Record<string, unknown>[] };
export type BucketEncryptionConfiguration = { rules: Record<string, unknown>[] };

export async function getBucketCors(accountId: S3AccountSelector, bucketName: string): Promise<BucketCors> {
  const { data } = await client.get<BucketCors>(`/manager/buckets/${encodeURIComponent(bucketName)}/cors`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function putBucketCors(accountId: S3AccountSelector, bucketName: string, rules: Record<string, unknown>[]): Promise<BucketCors> {
  const { data } = await client.put<BucketCors>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/cors`,
    { rules },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketCors(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`/manager/buckets/${encodeURIComponent(bucketName)}/cors`, { params: withS3AccountParam(undefined, accountId) });
}

export async function getBucketEncryption(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<BucketEncryptionConfiguration> {
  const { data } = await client.get<BucketEncryptionConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/encryption`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function putBucketEncryption(
  accountId: S3AccountSelector,
  bucketName: string,
  rules: Record<string, unknown>[]
): Promise<BucketEncryptionConfiguration> {
  const { data } = await client.put<BucketEncryptionConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/encryption`,
    { rules },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketEncryption(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`/manager/buckets/${encodeURIComponent(bucketName)}/encryption`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function getBucketTags(accountId: S3AccountSelector, bucketName: string): Promise<{ tags: BucketTag[] }> {
  const { data } = await client.get<{ tags: BucketTag[] }>(`/manager/buckets/${encodeURIComponent(bucketName)}/tags`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function putBucketTags(accountId: S3AccountSelector, bucketName: string, tags: BucketTag[]): Promise<void> {
  await client.put(
    `/manager/buckets/${encodeURIComponent(bucketName)}/tags`,
    { tags },
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function deleteBucketTags(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`/manager/buckets/${encodeURIComponent(bucketName)}/tags`, { params: withS3AccountParam(undefined, accountId) });
}

export async function getBucketLogging(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.get<BucketLoggingConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/logging`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function putBucketLogging(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: BucketLoggingConfiguration
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.put<BucketLoggingConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/logging`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketLogging(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`/manager/buckets/${encodeURIComponent(bucketName)}/logging`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function getBucketNotifications(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.get<BucketNotificationConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/notifications`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function putBucketNotifications(
  accountId: S3AccountSelector,
  bucketName: string,
  configuration: Record<string, unknown>
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.put<BucketNotificationConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/notifications`,
    { configuration },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketNotifications(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`/manager/buckets/${encodeURIComponent(bucketName)}/notifications`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function getBucketWebsite(accountId: S3AccountSelector, bucketName: string): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.get<BucketWebsiteConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/website`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function putBucketWebsite(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: BucketWebsiteConfiguration
): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.put<BucketWebsiteConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/website`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketWebsite(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`/manager/buckets/${encodeURIComponent(bucketName)}/website`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export type BucketQuotaUpdate = {
  max_size_gb?: number | null;
  max_size_unit?: string | null;
  max_objects?: number | null;
};

export async function updateBucketQuota(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: BucketQuotaUpdate
): Promise<void> {
  await client.put(`/manager/buckets/${encodeURIComponent(bucketName)}/quota`, payload, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export type BucketObjectLockUpdatePayload = {
  enabled?: boolean | null;
  mode?: string | null;
  days?: number | null;
  years?: number | null;
};

export async function getBucketObjectLock(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<BucketObjectLockConfiguration> {
  const { data } = await client.get<BucketObjectLockConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/object-lock`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updateBucketObjectLock(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: BucketObjectLockUpdatePayload
): Promise<BucketObjectLockConfiguration> {
  const { data } = await client.put<BucketObjectLockConfiguration>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/object-lock`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

function isTopLevelBrowserSurface(): boolean {
  if (typeof window === "undefined") return false;
  const normalizedPath = window.location.pathname.replace(/\/+$/, "");
  return normalizedPath === "/browser";
}

function bucketBasePath(): string {
  return isTopLevelBrowserSurface() ? "/browser/buckets/config" : "/manager/buckets";
}

function bucketPath(bucketName: string): string {
  return `${bucketBasePath()}/${encodeURIComponent(bucketName)}`;
}

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
  const { data } = await client.get<Bucket[]>(bucketBasePath(), {
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

export async function getBucketStats(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: { with_stats?: boolean }
): Promise<Bucket> {
  const { data } = await client.get<Bucket>(`${bucketPath(bucketName)}/stats`, {
    params: withS3AccountParam({ with_stats: options?.with_stats }, accountId),
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
    bucketBasePath(),
    {
      name,
      versioning: options?.versioning ?? false,
      location_constraint: locationConstraint || undefined,
    },
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function deleteBucket(name: string, accountId: S3AccountSelector): Promise<void> {
  await client.delete(bucketPath(name), { params: withS3AccountParam(undefined, accountId) });
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

export type BucketReplicationConfiguration = {
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

export type ManagerBucketCompareConfigFeature =
  | "versioning_status"
  | "object_lock"
  | "public_access_block"
  | "lifecycle_rules"
  | "cors_rules"
  | "bucket_policy"
  | "access_logging"
  | "tags";

export type ManagerBucketCompareRequest = {
  target_context_id: string;
  source_bucket: string;
  target_bucket: string;
  include_content?: boolean;
  include_config?: boolean;
  config_features?: ManagerBucketCompareConfigFeature[];
  diff_sample_limit?: number;
};

export type ManagerBucketObjectDiffEntry = {
  key: string;
  source_size?: number | null;
  target_size?: number | null;
  source_etag?: string | null;
  target_etag?: string | null;
  compare_by: "md5" | "size";
};

export type ManagerBucketContentDiff = {
  source_count: number;
  target_count: number;
  matched_count: number;
  different_count: number;
  only_source_count: number;
  only_target_count: number;
  only_source_sample: string[];
  only_target_sample: string[];
  different_sample: ManagerBucketObjectDiffEntry[];
};

export type ManagerBucketConfigDiffSection = {
  key: string;
  label: string;
  source?: unknown;
  target?: unknown;
  changed: boolean;
};

export type ManagerBucketConfigDiff = {
  changed: boolean;
  sections: ManagerBucketConfigDiffSection[];
};

export type ManagerBucketCompareResult = {
  source_context_id: string;
  target_context_id: string;
  source_bucket: string;
  target_bucket: string;
  has_differences: boolean;
  content_diff?: ManagerBucketContentDiff | null;
  config_diff?: ManagerBucketConfigDiff | null;
};

export type ManagerBucketCompareAction = "sync_source_only" | "sync_different" | "delete_target_only";

export type ManagerBucketCompareActionRequest = {
  target_context_id: string;
  source_bucket: string;
  target_bucket: string;
  action: ManagerBucketCompareAction;
  parallelism?: number;
};

export type ManagerBucketCompareActionResult = {
  action: ManagerBucketCompareAction;
  source_context_id: string;
  target_context_id: string;
  source_bucket: string;
  target_bucket: string;
  planned_count: number;
  succeeded_count: number;
  failed_count: number;
  failed_keys_sample: string[];
  message: string;
};

export async function getBucketProperties(accountId: S3AccountSelector, bucketName: string): Promise<BucketProperties> {
  const { data } = await client.get<BucketProperties>(`${bucketPath(bucketName)}/properties`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function compareManagerBucketPair(
  sourceContextId: S3AccountSelector,
  payload: ManagerBucketCompareRequest,
  options?: { signal?: AbortSignal }
): Promise<ManagerBucketCompareResult> {
  const { data } = await client.post<ManagerBucketCompareResult>(
    `${bucketBasePath()}/compare`,
    payload,
    {
      params: withS3AccountParam(undefined, sourceContextId),
      signal: options?.signal,
    }
  );
  return data;
}

export async function runManagerBucketCompareAction(
  sourceContextId: S3AccountSelector,
  payload: ManagerBucketCompareActionRequest,
  options?: { signal?: AbortSignal }
): Promise<ManagerBucketCompareActionResult> {
  const { data } = await client.post<ManagerBucketCompareActionResult>(
    `${bucketBasePath()}/compare/action`,
    payload,
    {
      params: withS3AccountParam(undefined, sourceContextId),
      signal: options?.signal,
    }
  );
  return data;
}

export async function getBucketAcl(accountId: S3AccountSelector, bucketName: string): Promise<BucketAcl> {
  const { data } = await client.get<BucketAcl>(`${bucketPath(bucketName)}/acl`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function updateBucketAcl(accountId: S3AccountSelector, bucketName: string, acl: string): Promise<BucketAcl> {
  const { data } = await client.put<BucketAcl>(
    `${bucketPath(bucketName)}/acl`,
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
    `${bucketPath(bucketName)}/public-access-block`,
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
    `${bucketPath(bucketName)}/public-access-block`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function setBucketVersioning(accountId: S3AccountSelector, bucketName: string, enabled: boolean): Promise<void> {
  await client.put(
    `${bucketPath(bucketName)}/versioning`,
    { enabled },
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export type BucketPolicy = { policy: Record<string, unknown> | null };

export async function getBucketPolicy(accountId: S3AccountSelector, bucketName: string): Promise<BucketPolicy> {
  const { data } = await client.get<BucketPolicy>(`${bucketPath(bucketName)}/policy`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function putBucketPolicy(accountId: S3AccountSelector, bucketName: string, policy: Record<string, unknown>): Promise<BucketPolicy> {
  const { data } = await client.put<BucketPolicy>(
    `${bucketPath(bucketName)}/policy`,
    { policy },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketPolicyApi(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`${bucketPath(bucketName)}/policy`, { params: withS3AccountParam(undefined, accountId) });
}

export async function getBucketLifecycle(accountId: S3AccountSelector, bucketName: string): Promise<BucketLifecycleConfig> {
  const { data } = await client.get<BucketLifecycleConfig>(`${bucketPath(bucketName)}/lifecycle`, {
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
    `${bucketPath(bucketName)}/lifecycle`,
    { rules },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketLifecycle(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`${bucketPath(bucketName)}/lifecycle`, { params: withS3AccountParam(undefined, accountId) });
}

export type BucketCors = { rules: Record<string, unknown>[] };
export type BucketEncryptionConfiguration = { rules: Record<string, unknown>[] };

export async function getBucketCors(accountId: S3AccountSelector, bucketName: string): Promise<BucketCors> {
  const { data } = await client.get<BucketCors>(`${bucketPath(bucketName)}/cors`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function putBucketCors(accountId: S3AccountSelector, bucketName: string, rules: Record<string, unknown>[]): Promise<BucketCors> {
  const { data } = await client.put<BucketCors>(
    `${bucketPath(bucketName)}/cors`,
    { rules },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketCors(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`${bucketPath(bucketName)}/cors`, { params: withS3AccountParam(undefined, accountId) });
}

export async function getBucketEncryption(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<BucketEncryptionConfiguration> {
  const { data } = await client.get<BucketEncryptionConfiguration>(
    `${bucketPath(bucketName)}/encryption`,
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
    `${bucketPath(bucketName)}/encryption`,
    { rules },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketEncryption(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`${bucketPath(bucketName)}/encryption`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function getBucketTags(accountId: S3AccountSelector, bucketName: string): Promise<{ tags: BucketTag[] }> {
  const { data } = await client.get<{ tags: BucketTag[] }>(`${bucketPath(bucketName)}/tags`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function putBucketTags(accountId: S3AccountSelector, bucketName: string, tags: BucketTag[]): Promise<void> {
  await client.put(
    `${bucketPath(bucketName)}/tags`,
    { tags },
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function deleteBucketTags(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`${bucketPath(bucketName)}/tags`, { params: withS3AccountParam(undefined, accountId) });
}

export async function getBucketLogging(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.get<BucketLoggingConfiguration>(
    `${bucketPath(bucketName)}/logging`,
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
    `${bucketPath(bucketName)}/logging`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketLogging(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`${bucketPath(bucketName)}/logging`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function getBucketNotifications(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.get<BucketNotificationConfiguration>(
    `${bucketPath(bucketName)}/notifications`,
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
    `${bucketPath(bucketName)}/notifications`,
    { configuration },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketNotifications(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`${bucketPath(bucketName)}/notifications`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function getBucketReplication(
  accountId: S3AccountSelector,
  bucketName: string
): Promise<BucketReplicationConfiguration> {
  const { data } = await client.get<BucketReplicationConfiguration>(
    `${bucketPath(bucketName)}/replication`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function putBucketReplication(
  accountId: S3AccountSelector,
  bucketName: string,
  configuration: Record<string, unknown>
): Promise<BucketReplicationConfiguration> {
  const { data } = await client.put<BucketReplicationConfiguration>(
    `${bucketPath(bucketName)}/replication`,
    { configuration },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketReplication(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`${bucketPath(bucketName)}/replication`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function getBucketWebsite(accountId: S3AccountSelector, bucketName: string): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.get<BucketWebsiteConfiguration>(
    `${bucketPath(bucketName)}/website`,
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
    `${bucketPath(bucketName)}/website`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteBucketWebsite(accountId: S3AccountSelector, bucketName: string): Promise<void> {
  await client.delete(`${bucketPath(bucketName)}/website`, {
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
  await client.put(`${bucketPath(bucketName)}/quota`, payload, {
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
    `${bucketPath(bucketName)}/object-lock`,
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
    `${bucketPath(bucketName)}/object-lock`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

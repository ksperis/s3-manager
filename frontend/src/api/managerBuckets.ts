/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { timeoutForRequestProfile } from "./client";
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";
import type { Bucket } from "./bucketContracts";

const MANAGER_BUCKETS_PATH = "/manager/buckets";

export type FeatureRuleFeature = "lifecycle" | "policy" | "cors" | "notifications" | "tags";
export type FeatureRuleInventoryStatus = "configured" | "empty" | "unavailable";

export type FeatureRuleInventoryRule = {
  id: string;
  type: string;
  title: string;
  summary: string;
  chips: string[];
  raw: Record<string, unknown>;
};

export type FeatureRuleInventoryBucket = {
  bucket_name: string;
  feature: FeatureRuleFeature;
  status: FeatureRuleInventoryStatus;
  rules: FeatureRuleInventoryRule[];
  error?: string | null;
};

export async function listBuckets(
  accountId: S3AccountSelector,
  options?: { include?: string[]; with_stats?: boolean; signal?: AbortSignal }
): Promise<Bucket[]> {
  const { data } = await client.get<Bucket[]>(MANAGER_BUCKETS_PATH, {
    params: withS3AccountParam(
      {
        include: options?.include?.join(","),
        with_stats: options?.with_stats,
      },
      accountId
    ),
    signal: options?.signal,
  });
  return data;
}

export async function listFeatureRuleInventory(
  accountId: S3AccountSelector,
  feature: FeatureRuleFeature
): Promise<FeatureRuleInventoryBucket[]> {
  const { data } = await client.get<FeatureRuleInventoryBucket[]>("/manager/feature-rules", {
    params: withS3AccountParam({ feature }, accountId),
    timeout: timeoutForRequestProfile("long_running"),
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
    MANAGER_BUCKETS_PATH,
    {
      name,
      versioning: options?.versioning ?? false,
      location_constraint: locationConstraint || undefined,
    },
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function deleteBucket(name: string, accountId: S3AccountSelector): Promise<void> {
  await client.delete(`${MANAGER_BUCKETS_PATH}/${encodeURIComponent(name)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export type ManagerBucketCompareConfigFeature =
  | "versioning_status"
  | "object_lock"
  | "public_access_block"
  | "lifecycle_rules"
  | "cors_rules"
  | "bucket_policy"
  | "access_logging"
  | "tags";

type ManagerBucketCompareRequest = {
  target_context_id: string;
  source_bucket: string;
  target_bucket: string;
  include_content?: boolean;
  include_config?: boolean;
  config_features?: ManagerBucketCompareConfigFeature[];
  ignore_modified_after?: string | null;
};

export type ManagerBucketObjectDetail = {
  key: string;
  size?: number | null;
  etag?: string | null;
  last_modified?: string | null;
  storage_class?: string | null;
};

type ManagerBucketObjectDiffEntry = {
  key: string;
  source_size?: number | null;
  target_size?: number | null;
  source_etag?: string | null;
  target_etag?: string | null;
  source_last_modified?: string | null;
  target_last_modified?: string | null;
  source_storage_class?: string | null;
  target_storage_class?: string | null;
  compare_by: "md5" | "size";
};

export type ManagerBucketContentDiff = {
  source_count: number;
  target_count: number;
  matched_count: number;
  different_count: number;
  only_source_count: number;
  only_target_count: number;
  ignored_after_cutoff_count?: number;
  display_limit?: number;
  only_source_hidden_count?: number;
  only_target_hidden_count?: number;
  different_hidden_count?: number;
  only_source_sample: string[];
  only_target_sample: string[];
  only_source_details?: ManagerBucketObjectDetail[];
  only_target_details?: ManagerBucketObjectDetail[];
  different_sample: ManagerBucketObjectDiffEntry[];
};

type ManagerBucketConfigDiffSection = {
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

type ManagerBucketCompareActionRequest = {
  target_context_id: string;
  source_bucket: string;
  target_bucket: string;
  action: ManagerBucketCompareAction;
  object_keys: string[];
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

export async function compareManagerBucketPair(
  sourceContextId: S3AccountSelector,
  payload: ManagerBucketCompareRequest,
  options?: { signal?: AbortSignal }
): Promise<ManagerBucketCompareResult> {
  const { data } = await client.post<ManagerBucketCompareResult>(
    `${MANAGER_BUCKETS_PATH}/compare`,
    payload,
    {
      params: withS3AccountParam(undefined, sourceContextId),
      signal: options?.signal,
      timeout: timeoutForRequestProfile("long_running"),
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
    `${MANAGER_BUCKETS_PATH}/compare/action`,
    payload,
    {
      params: withS3AccountParam(undefined, sourceContextId),
      signal: options?.signal,
      timeout: timeoutForRequestProfile("long_running"),
    }
  );
  return data;
}

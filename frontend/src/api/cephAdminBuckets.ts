/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { timeoutForRequestProfile } from "./client";
import type { PaginatedResponse } from "./types";
import type { BucketUiTagDefinition } from "./bucketUiTags";
import type { BucketFeatureStatus, BucketTag } from "./buckets";
import {
  buildBucketListingQuery,
  buildBucketListingRequestBody,
  shouldUsePostBucketListing,
} from "./bucketListingTransport";
import { resolveApiBaseUrl, streamBucketsWithSse } from "./sseBucketsStream";
import type { CephAdminListingStreamProgress } from "./cephAdminEntityListing";

export type CephAdminBucket = {
  name: string;
  bucket_name?: string | null;
  tenant?: string | null;
  owner?: string | null;
  owner_name?: string | null;
  owner_suspended?: boolean | null;
  context_id?: string | null;
  context_name?: string | null;
  context_kind?: "account" | "connection" | "s3_user" | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  owner_used_bytes?: number | null;
  owner_object_count?: number | null;
  owner_quota_max_size_bytes?: number | null;
  owner_quota_max_objects?: number | null;
  tags?: BucketTag[] | null;
  features?: Record<string, BucketFeatureStatus> | null;
  column_details?: Record<string, unknown> | null;
  ui_tags?: BucketUiTagDefinition[];
};

export type PaginatedCephAdminBucketsResponse = PaginatedResponse<CephAdminBucket> & {
  stats_available?: boolean;
  stats_warning?: string | null;
};

export type ListCephAdminBucketsParams = {
  page?: number;
  page_size?: number;
  filter?: string;
  advanced_filter?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include?: string[];
  with_stats?: boolean;
  ui_tag_ids?: number[];
  ui_tag_match?: "any" | "all";
};

export type CephAdminBucketsStreamProgress = CephAdminListingStreamProgress;

type CephAdminBucketsStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: CephAdminBucketsStreamProgress) => void;
};

type ListCephAdminBucketsOptions = {
  signal?: AbortSignal;
};

export type BucketListingCacheRefreshResponse = {
  refreshed: boolean;
  endpoint_id?: number;
  contexts?: number;
  endpoints?: number;
};

export type CephAdminBucketConfigBackupFeature =
  | "quota"
  | "versioning"
  | "object_lock"
  | "public_access_block"
  | "lifecycle"
  | "cors"
  | "policy"
  | "access_logging"
  | "tags";

type CephAdminBucketConfigBackupRequest = {
  buckets: string[];
  features: CephAdminBucketConfigBackupFeature[];
};

type CephAdminBucketConfigBackupBucket = {
  name: string;
  configuration: Record<string, unknown>;
  errors: Record<string, string>;
};

type CephAdminBucketConfigBackupResponse = {
  kind: string;
  version: number;
  generated_at: string;
  source: {
    surface: string;
    endpoint_id?: number | null;
    endpoint_name?: string | null;
  };
  features: CephAdminBucketConfigBackupFeature[];
  buckets: CephAdminBucketConfigBackupBucket[];
};

export async function listCephAdminBuckets(
  endpointId: number,
  params?: ListCephAdminBucketsParams,
  options?: ListCephAdminBucketsOptions
): Promise<PaginatedCephAdminBucketsResponse> {
  const usePost = shouldUsePostBucketListing(params);
  const { data } = usePost
    ? await client.post<PaginatedCephAdminBucketsResponse>(
        `/ceph-admin/endpoints/${endpointId}/buckets/query`,
        buildBucketListingRequestBody(params),
        {
          signal: options?.signal,
        }
      )
    : await client.get<PaginatedCephAdminBucketsResponse>(`/ceph-admin/endpoints/${endpointId}/buckets`, {
        params: buildBucketListingQuery(params),
        signal: options?.signal,
      });
  return data;
}

export async function refreshCephAdminBucketListingCache(
  endpointId: number
): Promise<BucketListingCacheRefreshResponse> {
  const { data } = await client.post<BucketListingCacheRefreshResponse>(
    `/ceph-admin/endpoints/${endpointId}/buckets/cache/refresh`
  );
  return data;
}

export async function backupCephAdminBucketConfigs(
  endpointId: number,
  payload: CephAdminBucketConfigBackupRequest,
  options?: { signal?: AbortSignal }
): Promise<CephAdminBucketConfigBackupResponse> {
  const { data } = await client.post<CephAdminBucketConfigBackupResponse>(
    `/ceph-admin/endpoints/${endpointId}/buckets/config-backup`,
    payload,
    { signal: options?.signal, timeout: timeoutForRequestProfile("long_running") }
  );
  return data;
}

export async function streamCephAdminBuckets(
  endpointId: number,
  params?: ListCephAdminBucketsParams,
  options?: CephAdminBucketsStreamOptions
): Promise<PaginatedCephAdminBucketsResponse> {
  const baseUrl = resolveApiBaseUrl();
  const query = buildBucketListingQuery(params);
  const queryText = query.toString();
  const url = `${baseUrl}/ceph-admin/endpoints/${endpointId}/buckets/stream${queryText ? `?${queryText}` : ""}`;
  return streamBucketsWithSse<CephAdminBucketsStreamProgress, PaginatedCephAdminBucketsResponse>({
    url,
    options,
    streamFailedLabel: "Advanced search stream failed",
    missingResultMessage: "Advanced search stream ended without a result payload",
  });
}

type CephAdminBucketCompareRequest = {
  target_endpoint_id: number;
  source_bucket: string;
  target_bucket: string;
  include_content?: boolean;
  include_config?: boolean;
  config_features?: CephAdminBucketCompareConfigFeature[];
  ignore_modified_after?: string | null;
};

export type CephAdminBucketCompareConfigFeature =
  | "versioning_status"
  | "object_lock"
  | "public_access_block"
  | "lifecycle_rules"
  | "cors_rules"
  | "bucket_policy"
  | "access_logging"
  | "tags";

type CephAdminBucketObjectDetail = {
  key: string;
  size?: number | null;
  etag?: string | null;
  last_modified?: string | null;
  storage_class?: string | null;
};

type CephAdminBucketObjectDiffEntry = {
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

export type CephAdminBucketContentDiff = {
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
  only_source_details?: CephAdminBucketObjectDetail[];
  only_target_details?: CephAdminBucketObjectDetail[];
  different_sample: CephAdminBucketObjectDiffEntry[];
};

type CephAdminBucketConfigDiffSection = {
  key: string;
  label: string;
  source?: unknown;
  target?: unknown;
  changed: boolean;
};

export type CephAdminBucketConfigDiff = {
  changed: boolean;
  sections: CephAdminBucketConfigDiffSection[];
};

export type CephAdminBucketCompareResult = {
  source_endpoint_id: number;
  target_endpoint_id: number;
  source_bucket: string;
  target_bucket: string;
  has_differences: boolean;
  content_diff?: CephAdminBucketContentDiff | null;
  config_diff?: CephAdminBucketConfigDiff | null;
};

export async function compareCephAdminBucketPair(
  sourceEndpointId: number,
  payload: CephAdminBucketCompareRequest,
  options?: { signal?: AbortSignal }
): Promise<CephAdminBucketCompareResult> {
  const { data } = await client.post<CephAdminBucketCompareResult>(
    `/ceph-admin/endpoints/${sourceEndpointId}/buckets/compare`,
    payload,
    { signal: options?.signal, timeout: timeoutForRequestProfile("long_running") }
  );
  return data;
}

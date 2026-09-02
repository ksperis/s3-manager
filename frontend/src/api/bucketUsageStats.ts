/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "./accountParams";
import type { BucketOperationTarget } from "./bucketOperation";
import { withS3AccountParam } from "./accountParams";
import client from "./client";
import {
  buildJsonPostRequestInit,
  resolveApiBaseUrl,
  streamBucketsWithSse,
} from "./sseBucketsStream";

export type BucketUsageStatsPayload = {
  buckets?: string[];
  targets?: BucketOperationTarget[];
  parallelism?: number;
};

type BucketUsageStatsScopePayload = {
  parallelism?: number;
};

export type BucketUsageStatsDistributionEntry = {
  key: string;
  label: string;
  count: number;
  bytes: number;
  ratio_count: number;
  ratio_bytes: number;
};

export type BucketUsageStatsSnapshot = {
  scope_kind: string;
  scope_id: string;
  scope_name?: string | null;
  bucket_name: string;
  scan_mode: "versions" | "current_only";
  version_listing_available: boolean;
  object_version_count: number;
  current_version_count: number;
  noncurrent_version_count: number;
  delete_marker_count: number;
  total_bytes: number;
  current_bytes: number;
  noncurrent_bytes: number;
  data_type_distribution: BucketUsageStatsDistributionEntry[];
  storage_class_distribution: BucketUsageStatsDistributionEntry[];
  size_distribution: BucketUsageStatsDistributionEntry[];
  age_distribution: BucketUsageStatsDistributionEntry[];
  current_vs_noncurrent: BucketUsageStatsDistributionEntry[];
  warnings: string[];
  calculated_at: string;
};

type BucketUsageStatsLatestResponse = {
  snapshot?: BucketUsageStatsSnapshot | null;
};

export type BucketUsageStatsAggregate = {
  scope_kind: string;
  scope_id: string;
  scope_name?: string | null;
  managed_account_count?: number | null;
  accounts_with_listed_buckets?: number | null;
  skipped_account_count?: number | null;
  bucket_count: number;
  buckets_with_snapshot: number;
  missing_bucket_count: number;
  partial_scan_count: number;
  object_version_count: number;
  current_version_count: number;
  noncurrent_version_count: number;
  delete_marker_count: number;
  total_bytes: number;
  current_bytes: number;
  noncurrent_bytes: number;
  data_type_distribution: BucketUsageStatsDistributionEntry[];
  storage_class_distribution: BucketUsageStatsDistributionEntry[];
  size_distribution: BucketUsageStatsDistributionEntry[];
  age_distribution: BucketUsageStatsDistributionEntry[];
  current_vs_noncurrent: BucketUsageStatsDistributionEntry[];
  warnings: string[];
  oldest_snapshot_at?: string | null;
  newest_snapshot_at?: string | null;
};

export type BucketUsageStatsAggregateResponse = {
  aggregate: BucketUsageStatsAggregate;
};

export type BucketUsageStatsBucketResult = {
  bucket_name: string;
  context_id?: string | null;
  context_name?: string | null;
  status: "completed" | "completed_with_warnings" | "failed" | "canceled";
  snapshot?: BucketUsageStatsSnapshot | null;
  duration_seconds: number;
  message?: string | null;
};

export type BucketUsageStatsProgress = {
  request_id?: string | null;
  stage: "prepare" | "list" | "persist" | "completed";
  bucket_name?: string | null;
  context_id?: string | null;
  context_name?: string | null;
  total_buckets: number;
  completed_buckets: number;
  listed_versions: number;
  listed_delete_markers: number;
  total_bytes: number;
  message?: string | null;
};

export type BucketUsageStatsResult = {
  status: "completed" | "completed_with_warnings" | "failed" | "canceled";
  total_buckets: number;
  completed_buckets: number;
  failed_buckets: number;
  listed_versions: number;
  listed_delete_markers: number;
  total_bytes: number;
  started_at: string;
  finished_at: string;
  buckets: BucketUsageStatsBucketResult[];
};

type BucketUsageStatsStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: BucketUsageStatsProgress) => void;
};

export async function getManagerUsageStatsAggregate(
  contextId: S3AccountSelector
): Promise<BucketUsageStatsAggregateResponse> {
  const { data } = await client.get<BucketUsageStatsAggregateResponse>(
    "/manager/usage-stats/latest",
    { params: withS3AccountParam(null, contextId) }
  );
  return data;
}

export async function getCephAdminUsageStatsAggregate(
  endpointId: number
): Promise<BucketUsageStatsAggregateResponse> {
  const { data } = await client.get<BucketUsageStatsAggregateResponse>(
    `/ceph-admin/endpoints/${endpointId}/usage-stats/latest`
  );
  return data;
}

export async function getAdminUsageStatsAggregate(
  endpointId: number
): Promise<BucketUsageStatsAggregateResponse> {
  const { data } = await client.get<BucketUsageStatsAggregateResponse>(
    "/admin/usage-stats/latest",
    { params: { endpoint_id: endpointId } }
  );
  return data;
}

export async function getManagerBucketUsageStats(
  contextId: S3AccountSelector,
  bucketName: string
): Promise<BucketUsageStatsLatestResponse> {
  const { data } = await client.get<BucketUsageStatsLatestResponse>(
    `/manager/buckets/${encodeURIComponent(bucketName)}/usage-stats`,
    { params: withS3AccountParam(null, contextId) }
  );
  return data;
}

export async function getCephAdminBucketUsageStats(
  endpointId: number,
  bucketName: string
): Promise<BucketUsageStatsLatestResponse> {
  const { data } = await client.get<BucketUsageStatsLatestResponse>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/usage-stats`
  );
  return data;
}

export function streamManagerUsageStatsAggregate(
  contextId: S3AccountSelector,
  payload: BucketUsageStatsScopePayload = {},
  options?: BucketUsageStatsStreamOptions
): Promise<BucketUsageStatsResult> {
  const baseUrl = resolveApiBaseUrl();
  const query = new URLSearchParams({ account_id: String(contextId) });
  return streamBucketsWithSse<BucketUsageStatsProgress, BucketUsageStatsResult>({
    url: `${baseUrl}/manager/usage-stats/stream?${query.toString()}`,
    options,
    requestInit: buildJsonPostRequestInit(payload),
    streamFailedLabel: "Bucket usage stats stream failed",
    missingResultMessage: "Bucket usage stats stream ended without a result payload",
  });
}

export function streamManagerBucketUsageStatsForBucket(
  contextId: S3AccountSelector,
  bucketName: string,
  options?: BucketUsageStatsStreamOptions
): Promise<BucketUsageStatsResult> {
  const baseUrl = resolveApiBaseUrl();
  const query = new URLSearchParams({ account_id: String(contextId) });
  return streamBucketsWithSse<BucketUsageStatsProgress, BucketUsageStatsResult>({
    url: `${baseUrl}/manager/buckets/${encodeURIComponent(bucketName)}/usage-stats/stream?${query.toString()}`,
    options,
    requestInit: buildJsonPostRequestInit({ buckets: [bucketName], parallelism: 1 }),
    streamFailedLabel: "Bucket usage stats stream failed",
    missingResultMessage: "Bucket usage stats stream ended without a result payload",
  });
}

export function streamCephAdminBucketUsageStats(
  endpointId: number,
  payload: BucketUsageStatsPayload,
  options?: BucketUsageStatsStreamOptions
): Promise<BucketUsageStatsResult> {
  const baseUrl = resolveApiBaseUrl();
  return streamBucketsWithSse<BucketUsageStatsProgress, BucketUsageStatsResult>({
    url: `${baseUrl}/ceph-admin/endpoints/${endpointId}/bucket-usage-stats/stream`,
    options,
    requestInit: buildJsonPostRequestInit(payload),
    streamFailedLabel: "Bucket usage stats stream failed",
    missingResultMessage: "Bucket usage stats stream ended without a result payload",
  });
}

export function streamCephAdminUsageStatsAggregate(
  endpointId: number,
  payload: BucketUsageStatsScopePayload = {},
  options?: BucketUsageStatsStreamOptions
): Promise<BucketUsageStatsResult> {
  const baseUrl = resolveApiBaseUrl();
  return streamBucketsWithSse<BucketUsageStatsProgress, BucketUsageStatsResult>({
    url: `${baseUrl}/ceph-admin/endpoints/${endpointId}/usage-stats/stream`,
    options,
    requestInit: buildJsonPostRequestInit(payload),
    streamFailedLabel: "Bucket usage stats stream failed",
    missingResultMessage: "Bucket usage stats stream ended without a result payload",
  });
}

export function streamAdminUsageStatsAggregate(
  endpointId: number,
  payload: BucketUsageStatsScopePayload = {},
  options?: BucketUsageStatsStreamOptions
): Promise<BucketUsageStatsResult> {
  const baseUrl = resolveApiBaseUrl();
  const query = new URLSearchParams({ endpoint_id: String(endpointId) });
  return streamBucketsWithSse<BucketUsageStatsProgress, BucketUsageStatsResult>({
    url: `${baseUrl}/admin/usage-stats/stream?${query.toString()}`,
    options,
    requestInit: buildJsonPostRequestInit(payload),
    streamFailedLabel: "Bucket usage stats stream failed",
    missingResultMessage: "Bucket usage stats stream ended without a result payload",
  });
}

export function streamCephAdminBucketUsageStatsForBucket(
  endpointId: number,
  bucketName: string,
  options?: BucketUsageStatsStreamOptions
): Promise<BucketUsageStatsResult> {
  const baseUrl = resolveApiBaseUrl();
  return streamBucketsWithSse<BucketUsageStatsProgress, BucketUsageStatsResult>({
    url: `${baseUrl}/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/usage-stats/stream`,
    options,
    requestInit: buildJsonPostRequestInit({ buckets: [bucketName], parallelism: 1 }),
    streamFailedLabel: "Bucket usage stats stream failed",
    missingResultMessage: "Bucket usage stats stream ended without a result payload",
  });
}

export function streamStorageOpsBucketUsageStats(
  payload: BucketUsageStatsPayload,
  options?: BucketUsageStatsStreamOptions
): Promise<BucketUsageStatsResult> {
  const baseUrl = resolveApiBaseUrl();
  return streamBucketsWithSse<BucketUsageStatsProgress, BucketUsageStatsResult>({
    url: `${baseUrl}/storage-ops/buckets/usage-stats/stream`,
    options,
    requestInit: buildJsonPostRequestInit(payload),
    streamFailedLabel: "Bucket usage stats stream failed",
    missingResultMessage: "Bucket usage stats stream ended without a result payload",
  });
}

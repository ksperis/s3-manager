/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "./accountParams";
import { resolveApiBaseUrl, streamBucketsWithSse } from "./sseBucketsStream";

export type BucketPurgeTarget = {
  context_id: string;
  bucket_name: string;
};

export type BucketPurgePayload = {
  buckets?: string[];
  targets?: BucketPurgeTarget[];
  parallelism?: number;
  include_versions?: boolean;
  confirmation: string;
};

export type BucketPurgeFailure = {
  bucket_name: string;
  key?: string | null;
  version_id?: string | null;
  stage: "list" | "delete" | "versions";
  message: string;
  count: number;
};

export type BucketPurgeBucketResult = {
  bucket_name: string;
  context_id?: string | null;
  context_name?: string | null;
  status: "completed" | "completed_with_errors" | "failed" | "canceled";
  listed_objects: number;
  listed_versions: number;
  deleted_objects: number;
  deleted_versions: number;
  failed_count: number;
  duration_seconds: number;
  failures_sample: BucketPurgeFailure[];
};

export type BucketPurgeProgress = {
  request_id?: string | null;
  stage: "prepare" | "list" | "delete" | "versions" | "completed";
  bucket_name?: string | null;
  context_id?: string | null;
  context_name?: string | null;
  total_buckets: number;
  completed_buckets: number;
  listed_objects: number;
  listed_versions: number;
  deleted_objects: number;
  deleted_versions: number;
  failed_count: number;
  message?: string | null;
};

export type BucketPurgeResult = {
  status: "completed" | "completed_with_errors" | "failed" | "canceled";
  total_buckets: number;
  completed_buckets: number;
  listed_objects: number;
  listed_versions: number;
  deleted_objects: number;
  deleted_versions: number;
  failed_count: number;
  started_at: string;
  finished_at: string;
  buckets: BucketPurgeBucketResult[];
};

export type BucketPurgeStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: BucketPurgeProgress) => void;
};

function buildJsonPostInit(payload: BucketPurgePayload): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

export function streamManagerBucketPurge(
  contextId: S3AccountSelector,
  payload: BucketPurgePayload,
  options?: BucketPurgeStreamOptions
): Promise<BucketPurgeResult> {
  const baseUrl = resolveApiBaseUrl();
  const query = new URLSearchParams({ account_id: String(contextId) });
  return streamBucketsWithSse<BucketPurgeProgress, BucketPurgeResult>({
    url: `${baseUrl}/manager/bucket-purge/stream?${query.toString()}`,
    options,
    requestInit: buildJsonPostInit(payload),
    streamFailedLabel: "Bucket purge stream failed",
    missingResultMessage: "Bucket purge stream ended without a result payload",
  });
}

export function streamCephAdminBucketPurge(
  endpointId: number,
  payload: BucketPurgePayload,
  options?: BucketPurgeStreamOptions
): Promise<BucketPurgeResult> {
  const baseUrl = resolveApiBaseUrl();
  return streamBucketsWithSse<BucketPurgeProgress, BucketPurgeResult>({
    url: `${baseUrl}/ceph-admin/endpoints/${endpointId}/buckets/purge/stream`,
    options,
    requestInit: buildJsonPostInit(payload),
    streamFailedLabel: "Bucket purge stream failed",
    missingResultMessage: "Bucket purge stream ended without a result payload",
  });
}

export function streamStorageOpsBucketPurge(
  payload: BucketPurgePayload,
  options?: BucketPurgeStreamOptions
): Promise<BucketPurgeResult> {
  const baseUrl = resolveApiBaseUrl();
  return streamBucketsWithSse<BucketPurgeProgress, BucketPurgeResult>({
    url: `${baseUrl}/storage-ops/buckets/purge/stream`,
    options,
    requestInit: buildJsonPostInit(payload),
    streamFailedLabel: "Bucket purge stream failed",
    missingResultMessage: "Bucket purge stream ended without a result payload",
  });
}

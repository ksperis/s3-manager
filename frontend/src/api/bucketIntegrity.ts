/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "./accountParams";
import { resolveApiBaseUrl, streamBucketsWithSse } from "./sseBucketsStream";

export type BucketIntegrityTarget = {
  context_id: string;
  bucket_name: string;
};

export type BucketIntegrityCheckPayload = {
  buckets?: string[];
  targets?: BucketIntegrityTarget[];
  parallelism?: number;
  all_versions?: boolean;
  since?: string | null;
  max_mb_per_object?: number | null;
};

export type BucketIntegrityFailure = {
  bucket_name: string;
  key?: string | null;
  version_id?: string | null;
  stage: "list" | "get";
  message: string;
};

export type BucketIntegrityBucketResult = {
  bucket_name: string;
  context_id?: string | null;
  context_name?: string | null;
  status: "passed" | "completed_with_errors" | "failed" | "canceled";
  listed_count: number;
  checked_count: number;
  failed_count: number;
  bytes_read: number;
  duration_seconds: number;
  failures_sample: BucketIntegrityFailure[];
};

export type BucketIntegrityProgress = {
  request_id?: string | null;
  stage: "prepare" | "list" | "verify" | "completed";
  bucket_name?: string | null;
  context_id?: string | null;
  context_name?: string | null;
  total_buckets: number;
  completed_buckets: number;
  listed_count: number;
  checked_count: number;
  failed_count: number;
  bytes_read: number;
  message?: string | null;
};

export type BucketIntegrityResult = {
  status: "passed" | "completed_with_errors" | "failed" | "canceled";
  total_buckets: number;
  completed_buckets: number;
  listed_count: number;
  checked_count: number;
  failed_count: number;
  bytes_read: number;
  started_at: string;
  finished_at: string;
  buckets: BucketIntegrityBucketResult[];
};

export type BucketIntegrityStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: BucketIntegrityProgress) => void;
};

function buildJsonPostInit(payload: BucketIntegrityCheckPayload): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

export function streamManagerBucketIntegrityCheck(
  contextId: S3AccountSelector,
  payload: BucketIntegrityCheckPayload,
  options?: BucketIntegrityStreamOptions
): Promise<BucketIntegrityResult> {
  const baseUrl = resolveApiBaseUrl();
  const query = new URLSearchParams({ account_id: String(contextId) });
  return streamBucketsWithSse<BucketIntegrityProgress, BucketIntegrityResult>({
    url: `${baseUrl}/manager/bucket-integrity/stream?${query.toString()}`,
    options,
    requestInit: buildJsonPostInit(payload),
    streamFailedLabel: "Bucket integrity check stream failed",
    missingResultMessage: "Bucket integrity check stream ended without a result payload",
  });
}

export function streamCephAdminBucketIntegrityCheck(
  endpointId: number,
  payload: BucketIntegrityCheckPayload,
  options?: BucketIntegrityStreamOptions
): Promise<BucketIntegrityResult> {
  const baseUrl = resolveApiBaseUrl();
  return streamBucketsWithSse<BucketIntegrityProgress, BucketIntegrityResult>({
    url: `${baseUrl}/ceph-admin/endpoints/${endpointId}/buckets/integrity-check/stream`,
    options,
    requestInit: buildJsonPostInit(payload),
    streamFailedLabel: "Bucket integrity check stream failed",
    missingResultMessage: "Bucket integrity check stream ended without a result payload",
  });
}

export function streamStorageOpsBucketIntegrityCheck(
  payload: BucketIntegrityCheckPayload,
  options?: BucketIntegrityStreamOptions
): Promise<BucketIntegrityResult> {
  const baseUrl = resolveApiBaseUrl();
  return streamBucketsWithSse<BucketIntegrityProgress, BucketIntegrityResult>({
    url: `${baseUrl}/storage-ops/buckets/integrity-check/stream`,
    options,
    requestInit: buildJsonPostInit(payload),
    streamFailedLabel: "Bucket integrity check stream failed",
    missingResultMessage: "Bucket integrity check stream ended without a result payload",
  });
}

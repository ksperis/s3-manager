/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  buildJsonPostRequestInit,
  resolveApiBaseUrl,
  streamBucketsWithSse,
} from "./sseBucketsStream";

export type BucketIndexCheckTarget = {
  name: string;
  tenant?: string | null;
};

type BucketIndexCheckPayload = {
  targets: BucketIndexCheckTarget[];
  parallelism?: number;
};

export type BucketIndexCheckProgress = {
  request_id?: string | null;
  stage: "prepare" | "completed";
  bucket_name?: string | null;
  tenant?: string | null;
  total_buckets: number;
  completed_buckets: number;
  failed_buckets: number;
  message?: string | null;
};

export type BucketIndexCheckBucketResult = {
  name: string;
  tenant?: string | null;
  status: "completed" | "failed";
  duration_seconds: number;
  operation: "check_bucket_index";
  rgw_status_code?: number | null;
  rgw_error_code?: string | null;
  message: string;
  result?: unknown;
};

export type BucketIndexCheckResult = {
  status: "completed" | "completed_with_errors" | "failed" | "canceled";
  total_buckets: number;
  completed_buckets: number;
  failed_buckets: number;
  started_at: string;
  finished_at: string;
  buckets: BucketIndexCheckBucketResult[];
};

type BucketIndexCheckStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: BucketIndexCheckProgress) => void;
};

export async function streamCephAdminBucketIndexChecks(
  endpointId: number,
  payload: BucketIndexCheckPayload,
  options?: BucketIndexCheckStreamOptions
): Promise<BucketIndexCheckResult> {
  return streamBucketsWithSse<BucketIndexCheckProgress, BucketIndexCheckResult>({
    url: `${resolveApiBaseUrl()}/ceph-admin/endpoints/${endpointId}/bucket-index-check/stream`,
    options,
    streamFailedLabel: "Bucket index check failed",
    missingResultMessage: "Bucket index check stream ended without a result",
    requestInit: buildJsonPostRequestInit(payload),
  });
}

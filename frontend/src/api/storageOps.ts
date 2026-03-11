/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import {
  deleteBucketCors,
  deleteBucketLifecycle,
  deleteBucketLogging,
  deleteBucketPolicyApi,
  getBucketCors,
  getBucketEncryption,
  getBucketLifecycle,
  getBucketLogging,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  getBucketWebsite,
  putBucketCors,
  putBucketLifecycle,
  putBucketLogging,
  putBucketPolicy,
  setBucketVersioning,
  updateBucketObjectLock,
  updateBucketPublicAccessBlock,
  updateBucketQuota,
} from "./buckets";
import type {
  BucketCors,
  BucketEncryptionConfiguration,
  BucketLifecycleConfig,
  BucketLoggingConfiguration,
  BucketObjectLockConfiguration,
  BucketObjectLockUpdatePayload,
  BucketPolicy,
  BucketProperties,
  BucketPublicAccessBlock,
  BucketQuotaUpdate,
  BucketWebsiteConfiguration,
} from "./buckets";
import type {
  CephAdminBucket,
  CephAdminBucketsStreamProgress,
  ListCephAdminBucketsParams,
  PaginatedCephAdminBucketsResponse,
} from "./cephAdmin";

export type { CephAdminBucket };
export type { BucketProperties };

export const STORAGE_OPS_BUCKET_REF_SEPARATOR = "::";
export const STORAGE_OPS_SCOPE_ID = 1;

export type StorageOpsBucket = CephAdminBucket & {
  context_id: string;
  context_name: string;
  context_kind: "account" | "connection";
  endpoint_name?: string | null;
  bucket_name?: string | null;
};

export type PaginatedStorageOpsBucketsResponse = Omit<PaginatedCephAdminBucketsResponse, "items"> & {
  items: StorageOpsBucket[];
};

export type StorageOpsBucketRef = {
  contextId: string;
  bucketName: string;
};

type CephAdminBucketsStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: CephAdminBucketsStreamProgress) => void;
};

type ListStorageOpsBucketsOptions = {
  signal?: AbortSignal;
};

export function encodeStorageOpsBucketRef(contextId: string, bucketName: string): string {
  return `${contextId}${STORAGE_OPS_BUCKET_REF_SEPARATOR}${bucketName}`;
}

export function decodeStorageOpsBucketRef(value: string): StorageOpsBucketRef | null {
  const text = String(value ?? "");
  const separatorIndex = text.indexOf(STORAGE_OPS_BUCKET_REF_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const contextId = text.slice(0, separatorIndex).trim();
  const bucketName = text.slice(separatorIndex + STORAGE_OPS_BUCKET_REF_SEPARATOR.length).trim();
  if (!contextId || !bucketName) return null;
  return { contextId, bucketName };
}

function resolveBucketTarget(bucketRef: string): StorageOpsBucketRef {
  const decoded = decodeStorageOpsBucketRef(bucketRef);
  if (!decoded) {
    throw new Error("Invalid Storage Ops bucket identifier");
  }
  return decoded;
}

function buildStorageOpsBucketsQuery(params?: ListCephAdminBucketsParams): URLSearchParams {
  const query = new URLSearchParams();
  if (!params) return query;
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.page_size !== undefined) query.set("page_size", String(params.page_size));
  if (typeof params.filter === "string" && params.filter.trim().length > 0) query.set("filter", params.filter);
  if (typeof params.advanced_filter === "string" && params.advanced_filter.trim().length > 0) {
    query.set("advanced_filter", params.advanced_filter);
  }
  if (typeof params.sort_by === "string" && params.sort_by.trim().length > 0) query.set("sort_by", params.sort_by);
  if (typeof params.sort_dir === "string" && params.sort_dir.trim().length > 0) query.set("sort_dir", params.sort_dir);
  if (Array.isArray(params.include) && params.include.length > 0) query.set("include", params.include.join(","));
  if (params.with_stats !== undefined) query.set("with_stats", params.with_stats ? "true" : "false");
  return query;
}

function resolveApiBaseUrl(): string {
  const base = typeof client.defaults.baseURL === "string" && client.defaults.baseURL.trim() ? client.defaults.baseURL : "/api";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function isCancelledError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (typeof err !== "object" || err === null) return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  return name === "CanceledError" || code === "ERR_CANCELED";
}

export async function listStorageOpsBuckets(
  _scopeId: number,
  params?: ListCephAdminBucketsParams,
  options?: ListStorageOpsBucketsOptions
): Promise<PaginatedStorageOpsBucketsResponse> {
  const { data } = await client.get<PaginatedStorageOpsBucketsResponse>("/storage-ops/buckets", {
    params: {
      ...params,
      include: params?.include?.join(","),
    },
    signal: options?.signal,
  });
  return data;
}

export async function streamStorageOpsBuckets(
  _scopeId: number,
  params?: ListCephAdminBucketsParams,
  options?: CephAdminBucketsStreamOptions
): Promise<PaginatedStorageOpsBucketsResponse> {
  const baseUrl = resolveApiBaseUrl();
  const query = buildStorageOpsBucketsQuery(params);
  const queryText = query.toString();
  const url = `${baseUrl}/storage-ops/buckets/stream${queryText ? `?${queryText}` : ""}`;

  const buildHeaders = () => {
    const headers = new Headers({ Accept: "text/event-stream" });
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  };

  let response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(),
    credentials: "include",
    signal: options?.signal,
  });

  if (response.status === 401 || response.status === 419) {
    try {
      const refresh = await client.post<{ access_token: string; token_type: string }>(
        "/auth/refresh",
        undefined,
        { signal: options?.signal }
      );
      if (typeof window !== "undefined") {
        localStorage.setItem("token", refresh.data.access_token);
      }
      response = await fetch(url, {
        method: "GET",
        headers: buildHeaders(),
        credentials: "include",
        signal: options?.signal,
      });
    } catch (err) {
      if (isCancelledError(err)) throw err;
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Advanced search stream failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`Unexpected stream response content type: ${contentType}`);
  }
  if (!response.body) {
    throw new Error("Streaming response body is unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let currentDataLines: string[] = [];
  let resultPayload: PaginatedStorageOpsBucketsResponse | null = null;

  const handleEvent = () => {
    if (currentDataLines.length === 0) {
      currentEvent = "message";
      return;
    }
    const payloadText = currentDataLines.join("\n");
    currentDataLines = [];
    const payload = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};
    if (currentEvent === "progress") {
      options?.onProgress?.(payload as unknown as CephAdminBucketsStreamProgress);
    } else if (currentEvent === "result") {
      resultPayload = payload as unknown as PaginatedStorageOpsBucketsResponse;
    } else if (currentEvent === "error") {
      const detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
      throw new Error(detail || "Advanced search stream failed");
    }
    currentEvent = "message";
  };

  const processLine = (line: string) => {
    if (line === "") {
      handleEvent();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim() || "message";
      return;
    }
    if (line.startsWith("data:")) {
      currentDataLines.push(line.slice(5).trimStart());
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      processLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
    if (done) {
      if (buffer.length > 0) {
        processLine(buffer);
      }
      processLine("");
      break;
    }
  }

  if (!resultPayload) {
    throw new Error("Advanced search stream ended without a result payload");
  }
  return resultPayload;
}

export async function getStorageOpsBucketProperties(_scopeId: number, bucketRef: string): Promise<BucketProperties> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return getBucketProperties(contextId, bucketName);
}

export async function getStorageOpsBucketPublicAccessBlock(
  _scopeId: number,
  bucketRef: string
): Promise<BucketPublicAccessBlock> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return getBucketPublicAccessBlock(contextId, bucketName);
}

export async function updateStorageOpsBucketPublicAccessBlock(
  _scopeId: number,
  bucketRef: string,
  payload: BucketPublicAccessBlock
): Promise<BucketPublicAccessBlock> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return updateBucketPublicAccessBlock(contextId, bucketName, payload);
}

export async function getStorageOpsBucketLifecycle(_scopeId: number, bucketRef: string): Promise<BucketLifecycleConfig> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return getBucketLifecycle(contextId, bucketName);
}

export async function putStorageOpsBucketLifecycle(
  _scopeId: number,
  bucketRef: string,
  rules: Record<string, unknown>[]
): Promise<BucketLifecycleConfig> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return putBucketLifecycle(contextId, bucketName, rules);
}

export async function deleteStorageOpsBucketLifecycle(_scopeId: number, bucketRef: string): Promise<void> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  await deleteBucketLifecycle(contextId, bucketName);
}

export async function getStorageOpsBucketCors(_scopeId: number, bucketRef: string): Promise<BucketCors> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return getBucketCors(contextId, bucketName);
}

export async function putStorageOpsBucketCors(
  _scopeId: number,
  bucketRef: string,
  rules: Record<string, unknown>[]
): Promise<BucketCors> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return putBucketCors(contextId, bucketName, rules);
}

export async function deleteStorageOpsBucketCors(_scopeId: number, bucketRef: string): Promise<void> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  await deleteBucketCors(contextId, bucketName);
}

export async function getStorageOpsBucketPolicy(_scopeId: number, bucketRef: string): Promise<BucketPolicy> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return getBucketPolicy(contextId, bucketName);
}

export async function putStorageOpsBucketPolicy(
  _scopeId: number,
  bucketRef: string,
  policy: Record<string, unknown>
): Promise<BucketPolicy> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return putBucketPolicy(contextId, bucketName, policy);
}

export async function deleteStorageOpsBucketPolicy(_scopeId: number, bucketRef: string): Promise<void> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  await deleteBucketPolicyApi(contextId, bucketName);
}

export async function getStorageOpsBucketLogging(
  _scopeId: number,
  bucketRef: string
): Promise<BucketLoggingConfiguration> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return getBucketLogging(contextId, bucketName);
}

export async function putStorageOpsBucketLogging(
  _scopeId: number,
  bucketRef: string,
  payload: BucketLoggingConfiguration
): Promise<BucketLoggingConfiguration> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return putBucketLogging(contextId, bucketName, payload);
}

export async function deleteStorageOpsBucketLogging(_scopeId: number, bucketRef: string): Promise<void> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  await deleteBucketLogging(contextId, bucketName);
}

export async function getStorageOpsBucketWebsite(
  _scopeId: number,
  bucketRef: string
): Promise<BucketWebsiteConfiguration> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return getBucketWebsite(contextId, bucketName);
}

export async function getStorageOpsBucketEncryption(
  _scopeId: number,
  bucketRef: string
): Promise<BucketEncryptionConfiguration> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return getBucketEncryption(contextId, bucketName);
}

export async function setStorageOpsBucketVersioning(
  _scopeId: number,
  bucketRef: string,
  enabled: boolean
): Promise<void> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  await setBucketVersioning(contextId, bucketName, enabled);
}

export async function updateStorageOpsBucketObjectLock(
  _scopeId: number,
  bucketRef: string,
  payload: BucketObjectLockUpdatePayload
): Promise<BucketObjectLockConfiguration> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  return updateBucketObjectLock(contextId, bucketName, payload);
}

export async function updateStorageOpsBucketQuota(
  _scopeId: number,
  bucketRef: string,
  payload: BucketQuotaUpdate
): Promise<void> {
  const { contextId, bucketName } = resolveBucketTarget(bucketRef);
  await updateBucketQuota(contextId, bucketName, payload);
}

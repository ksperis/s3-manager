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
import {
  buildBucketListingQuery,
  buildBucketListingRequestBody,
  shouldUsePostBucketListing,
} from "./bucketListingTransport";
import { resolveApiBaseUrl, streamBucketsWithSse } from "./sseBucketsStream";

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

export async function listStorageOpsBuckets(
  _scopeId: number,
  params?: ListCephAdminBucketsParams,
  options?: ListStorageOpsBucketsOptions
): Promise<PaginatedStorageOpsBucketsResponse> {
  const usePost = shouldUsePostBucketListing(params);
  const { data } = usePost
    ? await client.post<PaginatedStorageOpsBucketsResponse>(
        "/storage-ops/buckets/query",
        buildBucketListingRequestBody(params),
        {
          signal: options?.signal,
        }
      )
    : await client.get<PaginatedStorageOpsBucketsResponse>("/storage-ops/buckets", {
        params: buildBucketListingQuery(params),
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
  const query = buildBucketListingQuery(params);
  const queryText = query.toString();
  const url = `${baseUrl}/storage-ops/buckets/stream${queryText ? `?${queryText}` : ""}`;
  return streamBucketsWithSse<CephAdminBucketsStreamProgress, PaginatedStorageOpsBucketsResponse>({
    url,
    options,
    streamFailedLabel: "Advanced search stream failed",
    missingResultMessage: "Advanced search stream ended without a result payload",
  });
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

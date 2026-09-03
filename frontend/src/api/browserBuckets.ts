/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";
import type { BucketVersioningStatus } from "./bucketContracts";
import type {
  BrowserSettings,
  BrowserUsageSummary,
  BucketCorsStatus,
  PaginatedBrowserBucketsResponse,
} from "./browserContracts";
import { buildBrowserWorkspaceHeaders } from "./browserRequestHeaders";
import type { BrowserRequestOptions } from "./browserWorkspace";
import client from "./client";

export async function searchBrowserBuckets(
  accountId: S3AccountSelector,
  options?: {
    search?: string;
    exact?: boolean;
    page?: number;
    pageSize?: number;
  } & BrowserRequestOptions,
): Promise<PaginatedBrowserBucketsResponse> {
  const params = withS3AccountParam(
    {
      search: options?.search?.trim() || undefined,
      exact: options?.exact ? true : undefined,
      page: options?.page ?? undefined,
      page_size: options?.pageSize ?? undefined,
    },
    accountId,
  );
  const { data } = await client.get<PaginatedBrowserBucketsResponse>(
    "/browser/buckets/search",
    {
      params,
      headers: buildBrowserWorkspaceHeaders(options),
    },
  );
  return data;
}

export async function fetchBrowserUsageSummary(
  accountId: S3AccountSelector,
  options?: BrowserRequestOptions,
): Promise<BrowserUsageSummary> {
  const { data } = await client.get<BrowserUsageSummary>(
    "/browser/usage-summary",
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    },
  );
  return data;
}

export async function createBrowserBucket(
  accountId: S3AccountSelector,
  name: string,
  options?: { versioning?: boolean } & BrowserRequestOptions,
): Promise<void> {
  await client.post(
    "/browser/buckets",
    {
      name,
      versioning: options?.versioning ?? false,
    },
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    },
  );
}

export async function getBrowserBucketVersioning(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: BrowserRequestOptions,
): Promise<BucketVersioningStatus> {
  const { data } = await client.get<BucketVersioningStatus>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/versioning`,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    },
  );
  return data;
}

export async function fetchBrowserSettings(
  accountId: S3AccountSelector,
  options?: BrowserRequestOptions,
): Promise<BrowserSettings> {
  const { data } = await client.get<BrowserSettings>("/browser/settings", {
    params: withS3AccountParam(undefined, accountId),
    headers: buildBrowserWorkspaceHeaders(options),
  });
  return data;
}

export async function getBrowserBucketCorsStatus(
  accountId: S3AccountSelector,
  bucketName: string,
  origin?: string,
  options?: BrowserRequestOptions,
): Promise<BucketCorsStatus> {
  const params = withS3AccountParam(origin ? { origin } : undefined, accountId);
  const { data } = await client.get<BucketCorsStatus>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/cors`,
    { params, headers: buildBrowserWorkspaceHeaders(options) },
  );
  return data;
}

export async function ensureBrowserBucketCors(
  accountId: S3AccountSelector,
  bucketName: string,
  origin: string,
  options?: BrowserRequestOptions,
): Promise<BucketCorsStatus> {
  const { data } = await client.post<BucketCorsStatus>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/cors/ensure`,
    { origin },
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    },
  );
  return data;
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import {
  buildBrowserWorkspaceHeaders,
  mergeBrowserHeaders,
} from "./browserRequestHeaders";
import { buildSseCustomerBackendHeaders } from "./browserSseCustomer";
import type {
  BrowserLazyColumnField,
  BrowserObjectColumnsResponse,
  BrowserObjectsQuery,
  CleanupObjectVersionsPayload,
  CleanupObjectVersionsResponse,
  CopyObjectPayload,
  DeleteObjectEntry,
  ListBrowserObjectsResponse,
  ListObjectVersionsResponse,
  ObjectAcl,
  ObjectLegalHold,
  ObjectMetadata,
  ObjectMetadataUpdate,
  ObjectRestoreRequest,
  ObjectRetention,
  ObjectTags,
  StsCredentials,
  StsStatus,
} from "./browserContracts";
import type { BrowserRequestOptions } from "./browserWorkspace";

export async function listBrowserObjects(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: { prefix?: string; continuationToken?: string | null; maxKeys?: number; signal?: AbortSignal; forceRefresh?: boolean } & BrowserObjectsQuery & BrowserRequestOptions
): Promise<ListBrowserObjectsResponse> {
  const params = withS3AccountParam(
    {
      prefix: options?.prefix ?? "",
      continuation_token: options?.continuationToken ?? undefined,
      max_keys: options?.maxKeys ?? undefined,
      query: options?.query?.trim() || undefined,
      query_exact: options?.exactMatch ? true : undefined,
      query_case_sensitive: options?.caseSensitive ? true : undefined,
      item_type: options?.type && options.type !== "all" ? options.type : undefined,
      storage_class: options?.storageClass && options.storageClass !== "all" ? options.storageClass : undefined,
      recursive: options?.recursive ? true : undefined,
      force_refresh: options?.forceRefresh ? true : undefined,
      sort_by:
        options?.sortBy && !(options.sortBy === "name" && (options?.sortDir ?? "asc") === "asc")
          ? options.sortBy
          : undefined,
      sort_dir:
        options?.sortDir && (options.sortDir !== "asc" || (options?.sortBy && options.sortBy !== "name"))
          ? options.sortDir
          : undefined,
    },
    accountId
  );
  const { data } = await client.get<ListBrowserObjectsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/objects`,
    { params, headers: buildBrowserWorkspaceHeaders(options), signal: options?.signal }
  );
  return data;
}

export async function fetchBrowserObjectColumns(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: {
    keys: string[];
    columns: BrowserLazyColumnField[];
  },
  options?: {
    sseCustomerKeyBase64?: string | null;
    signal?: AbortSignal;
  } & BrowserRequestOptions
): Promise<BrowserObjectColumnsResponse> {
  const { data } = await client.post<BrowserObjectColumnsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/objects/columns`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(options?.sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
      ),
      signal: options?.signal,
    }
  );
  return data;
}

export async function getStsStatus(
  accountId: S3AccountSelector,
  options?: BrowserRequestOptions,
): Promise<StsStatus> {
  const { data } = await client.get<StsStatus>("/browser/sts", {
    params: withS3AccountParam(undefined, accountId),
    headers: buildBrowserWorkspaceHeaders(options),
  });
  return data;
}

export async function getStsCredentials(
  accountId: S3AccountSelector,
  options?: BrowserRequestOptions,
): Promise<StsCredentials> {
  const { data } = await client.get<StsCredentials>("/browser/sts/credentials", {
    params: withS3AccountParam(undefined, accountId),
    headers: buildBrowserWorkspaceHeaders(options),
  });
  return data;
}

export async function listObjectVersions(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: {
    prefix?: string;
    delimiter?: string;
    key?: string | null;
    keyMarker?: string | null;
    versionIdMarker?: string | null;
    maxKeys?: number;
    signal?: AbortSignal;
    requestOptions?: BrowserRequestOptions;
  }
): Promise<ListObjectVersionsResponse> {
  const params = withS3AccountParam(
    {
      prefix: options?.prefix ?? "",
      delimiter: options?.delimiter ?? undefined,
      key: options?.key ?? undefined,
      key_marker: options?.keyMarker ?? undefined,
      version_id_marker: options?.versionIdMarker ?? undefined,
      max_keys: options?.maxKeys ?? undefined,
    },
    accountId
  );
  const { data } = await client.get<ListObjectVersionsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/versions`,
    {
      params,
      headers: buildBrowserWorkspaceHeaders(options?.requestOptions),
      signal: options?.signal,
    }
  );
  return data;
}

export async function fetchObjectMetadata(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  versionId?: string | null,
  sseCustomerKeyBase64?: string | null,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectMetadata> {
  const params = withS3AccountParam({ key, version_id: versionId ?? undefined }, accountId);
  const { data } = await client.get<ObjectMetadata>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-meta`,
    {
      params,
      headers: mergeBrowserHeaders(
        buildSseCustomerBackendHeaders(sseCustomerKeyBase64),
        buildBrowserWorkspaceHeaders(options),
      ),
      signal,
    }
  );
  return data;
}

export async function getObjectTags(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  versionId?: string | null,
  options?: BrowserRequestOptions,
): Promise<ObjectTags> {
  const params = withS3AccountParam({ key, version_id: versionId ?? undefined }, accountId);
  const { data } = await client.get<ObjectTags>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-tags`,
    { params, headers: buildBrowserWorkspaceHeaders(options) }
  );
  return data;
}

export async function updateObjectTags(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectTags,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectTags> {
  const { data } = await client.put<ObjectTags>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-tags`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
      signal,
    }
  );
  return data;
}

export async function updateObjectMetadata(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectMetadataUpdate,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectMetadata> {
  const { data } = await client.put<ObjectMetadata>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-meta`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
      signal,
    }
  );
  return data;
}

export async function updateObjectAcl(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectAcl,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectAcl> {
  const { data } = await client.put<ObjectAcl>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-acl`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
      signal,
    }
  );
  return data;
}

export async function getObjectLegalHold(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  versionId?: string | null,
  options?: BrowserRequestOptions,
): Promise<ObjectLegalHold> {
  const params = withS3AccountParam({ key, version_id: versionId ?? undefined }, accountId);
  const { data } = await client.get<ObjectLegalHold>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-legal-hold`,
    { params, headers: buildBrowserWorkspaceHeaders(options) }
  );
  return data;
}

export async function updateObjectLegalHold(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectLegalHold,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectLegalHold> {
  const { data } = await client.put<ObjectLegalHold>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-legal-hold`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
      signal,
    }
  );
  return data;
}

export async function getObjectRetention(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  versionId?: string | null,
  options?: BrowserRequestOptions,
): Promise<ObjectRetention> {
  const params = withS3AccountParam({ key, version_id: versionId ?? undefined }, accountId);
  const { data } = await client.get<ObjectRetention>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-retention`,
    { params, headers: buildBrowserWorkspaceHeaders(options) }
  );
  return data;
}

export async function updateObjectRetention(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectRetention,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<ObjectRetention> {
  const { data } = await client.put<ObjectRetention>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-retention`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
      signal,
    }
  );
  return data;
}

export async function restoreObject(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectRestoreRequest,
  options?: BrowserRequestOptions,
): Promise<void> {
  await client.post(
    `/browser/buckets/${encodeURIComponent(bucketName)}/object-restore`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    }
  );
}

export async function copyObject(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: CopyObjectPayload,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<void> {
  await client.post(`/browser/buckets/${encodeURIComponent(bucketName)}/copy`, payload, {
    params: withS3AccountParam(undefined, accountId),
    headers: buildBrowserWorkspaceHeaders(options),
    signal,
  });
}

export async function deleteObjects(
  accountId: S3AccountSelector,
  bucketName: string,
  objects: DeleteObjectEntry[],
  signal?: AbortSignal,
  options?: BrowserRequestOptions
): Promise<number> {
  const { data } = await client.post<{ deleted: number }>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/delete`,
    { objects },
    { params: withS3AccountParam(undefined, accountId), headers: buildBrowserWorkspaceHeaders(options), signal }
  );
  return data.deleted;
}

export async function cleanupObjectVersions(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: CleanupObjectVersionsPayload,
  signal?: AbortSignal,
  options?: BrowserRequestOptions,
): Promise<CleanupObjectVersionsResponse> {
  const { data } = await client.post<CleanupObjectVersionsResponse>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/versions/cleanup`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
      signal,
    }
  );
  return data;
}

export async function createFolder(
  accountId: S3AccountSelector,
  bucketName: string,
  prefix: string,
  options?: BrowserRequestOptions
): Promise<void> {
  await client.post(
    `/browser/buckets/${encodeURIComponent(bucketName)}/folders`,
    { prefix },
    { params: withS3AccountParam(undefined, accountId), headers: buildBrowserWorkspaceHeaders(options) }
  );
}

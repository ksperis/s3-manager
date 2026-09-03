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
import type { StorageSpaceIconDescriptor } from "./storageSpaceIcons";

export type BrowserWorkspaceSurface = "browser" | "manager" | "ceph-admin" | "portal";
export type BrowserRequestOptions = {
  workspaceSurface?: BrowserWorkspaceSurface;
};

export type BrowserBucket = {
  name: string;
  creation_date?: string | null;
  display_name?: string | null;
  workspace_label?: string | null;
  description?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  status?: string | null;
  role?: string | null;
  internal_bucket_name?: string | null;
  icon?: StorageSpaceIconDescriptor | null;
};

type PaginatedBrowserBucketsResponse = {
  items: BrowserBucket[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
};

export type BrowserUsageSummary = {
  available: boolean;
  source?: "account" | "s3_user" | "portal" | "connection" | null;
  label?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
};

type BucketVersioningStatus = {
  status?: string | null;
  enabled: boolean;
};

export type BrowserObject = {
  key: string;
  size: number;
  last_modified?: string | null;
  etag?: string | null;
  storage_class?: string | null;
  is_delete_marker?: boolean;
  version_id?: string | null;
};

export type ListBrowserObjectsResponse = {
  prefix: string;
  objects: BrowserObject[];
  prefixes: string[];
  is_truncated: boolean;
  next_continuation_token?: string | null;
};

export type BrowserSettings = {
  allow_proxy_transfers: boolean;
  direct_upload_parallelism: number;
  proxy_upload_parallelism: number;
  direct_download_parallelism: number;
  proxy_download_parallelism: number;
  other_operations_parallelism: number;
  streaming_zip_threshold_mb: number;
};

type BrowserObjectsQuery = {
  query?: string;
  exactMatch?: boolean;
  caseSensitive?: boolean;
  type?: "all" | "file" | "folder";
  storageClass?: string;
  recursive?: boolean;
  sortBy?: "name" | "size" | "modified" | "storage_class" | "etag";
  sortDir?: "asc" | "desc";
};

export type BrowserObjectVersion = {
  key: string;
  version_id?: string | null;
  is_latest: boolean;
  is_delete_marker: boolean;
  last_modified?: string | null;
  size?: number | null;
  etag?: string | null;
  storage_class?: string | null;
};

type ListObjectVersionsResponse = {
  prefix?: string | null;
  common_prefixes?: string[];
  versions: BrowserObjectVersion[];
  delete_markers: BrowserObjectVersion[];
  is_truncated: boolean;
  key_marker?: string | null;
  version_id_marker?: string | null;
  next_key_marker?: string | null;
  next_version_id_marker?: string | null;
};

export type ObjectMetadata = {
  key: string;
  size: number;
  etag?: string | null;
  last_modified?: string | null;
  content_type?: string | null;
  cache_control?: string | null;
  content_disposition?: string | null;
  content_encoding?: string | null;
  content_language?: string | null;
  expires?: string | null;
  storage_class?: string | null;
  restore_status?: string | null;
  metadata: Record<string, string>;
  version_id?: string | null;
};

export type ObjectTag = { key: string; value: string };

type BrowserLazyColumnField =
  | "content_type"
  | "tags_count"
  | "metadata_count"
  | "cache_control"
  | "expires"
  | "restore_status";

type BrowserObjectColumnValues = {
  key: string;
  content_type?: string | null;
  tags_count?: number | null;
  metadata_count?: number | null;
  cache_control?: string | null;
  expires?: string | null;
  restore_status?: string | null;
  metadata_status: "ready" | "error";
  tags_status: "ready" | "error";
};

type BrowserObjectColumnsResponse = {
  items: BrowserObjectColumnValues[];
};

export type ObjectTags = {
  key: string;
  tags: ObjectTag[];
  version_id?: string | null;
};

export type ObjectMetadataUpdate = {
  key: string;
  version_id?: string | null;
  content_type?: string | null;
  cache_control?: string | null;
  content_disposition?: string | null;
  content_encoding?: string | null;
  content_language?: string | null;
  expires?: string | null;
  metadata?: Record<string, string> | null;
  storage_class?: string | null;
};

type ObjectAcl = {
  key: string;
  acl: string;
  version_id?: string | null;
};

export type ObjectLegalHold = {
  key: string;
  status?: "ON" | "OFF" | null;
  version_id?: string | null;
};

export type ObjectRetention = {
  key: string;
  mode?: "GOVERNANCE" | "COMPLIANCE" | null;
  retain_until?: string | null;
  bypass_governance?: boolean | null;
  version_id?: string | null;
};

export type ObjectRestoreRequest = {
  key: string;
  days: number;
  tier?: "Standard" | "Bulk" | "Expedited" | null;
  version_id?: string | null;
};

type CopyObjectPayload = {
  source_bucket?: string;
  source_key: string;
  destination_key: string;
  source_version_id?: string | null;
  metadata?: Record<string, string>;
  replace_metadata?: boolean;
  tags?: ObjectTag[];
  replace_tags?: boolean;
  acl?: string | null;
  move?: boolean;
};

type DeleteObjectEntry = {
  key: string;
  version_id?: string | null;
};

type CleanupObjectVersionsPayload = {
  prefix?: string;
  keep_last_n?: number;
  older_than_days?: number;
  delete_orphan_markers?: boolean;
};

type CleanupObjectVersionsResponse = {
  prefix?: string | null;
  deleted_versions: number;
  deleted_delete_markers: number;
  scanned_versions: number;
  scanned_delete_markers: number;
};

export type BucketCorsRule = {
  allowed_origins: string[];
  allowed_methods: string[];
  allowed_headers: string[];
  expose_headers: string[];
  max_age_seconds?: number | null;
};

export type BucketCorsStatus = {
  enabled: boolean;
  rules: BucketCorsRule[];
  error?: string | null;
};

export type StsStatus = {
  available: boolean;
  error?: string | null;
};

export type StsCredentials = {
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
  expiration: string;
  endpoint: string;
  region: string;
};

export async function searchBrowserBuckets(
  accountId: S3AccountSelector,
  options?: {
    search?: string;
    exact?: boolean;
    page?: number;
    pageSize?: number;
  } & BrowserRequestOptions
): Promise<PaginatedBrowserBucketsResponse> {
  const params = withS3AccountParam(
    {
      search: options?.search?.trim() || undefined,
      exact: options?.exact ? true : undefined,
      page: options?.page ?? undefined,
      page_size: options?.pageSize ?? undefined,
    },
    accountId
  );
  const { data } = await client.get<PaginatedBrowserBucketsResponse>("/browser/buckets/search", {
    params,
    headers: buildBrowserWorkspaceHeaders(options),
  });
  return data;
}

export async function fetchBrowserUsageSummary(
  accountId: S3AccountSelector,
  options?: BrowserRequestOptions
): Promise<BrowserUsageSummary> {
  const { data } = await client.get<BrowserUsageSummary>("/browser/usage-summary", {
    params: withS3AccountParam(undefined, accountId),
    headers: buildBrowserWorkspaceHeaders(options),
  });
  return data;
}

export async function createBrowserBucket(
  accountId: S3AccountSelector,
  name: string,
  options?: { versioning?: boolean } & BrowserRequestOptions
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
    }
  );
}

export async function getBucketVersioning(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: BrowserRequestOptions
): Promise<BucketVersioningStatus> {
  const { data } = await client.get<BucketVersioningStatus>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/versioning`,
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    }
  );
  return data;
}

export async function fetchBrowserSettings(
  accountId: S3AccountSelector,
  options?: BrowserRequestOptions
): Promise<BrowserSettings> {
  const { data } = await client.get<BrowserSettings>("/browser/settings", {
    params: withS3AccountParam(undefined, accountId),
    headers: buildBrowserWorkspaceHeaders(options),
  });
  return data;
}

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

export async function getBucketCorsStatus(
  accountId: S3AccountSelector,
  bucketName: string,
  origin?: string,
  options?: BrowserRequestOptions
): Promise<BucketCorsStatus> {
  const params = withS3AccountParam(origin ? { origin } : undefined, accountId);
  const { data } = await client.get<BucketCorsStatus>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/cors`,
    { params, headers: buildBrowserWorkspaceHeaders(options) }
  );
  return data;
}

export async function ensureBucketCors(
  accountId: S3AccountSelector,
  bucketName: string,
  origin: string,
  options?: BrowserRequestOptions
): Promise<BucketCorsStatus> {
  const { data } = await client.post<BucketCorsStatus>(
    `/browser/buckets/${encodeURIComponent(bucketName)}/cors/ensure`,
    { origin },
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
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

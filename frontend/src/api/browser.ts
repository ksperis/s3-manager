/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type BrowserBucket = {
  name: string;
  creation_date?: string | null;
};

export type BrowserObject = {
  key: string;
  size: number;
  last_modified?: string | null;
  etag?: string | null;
  storage_class?: string | null;
};

export type ListBrowserObjectsResponse = {
  prefix: string;
  objects: BrowserObject[];
  prefixes: string[];
  is_truncated: boolean;
  next_continuation_token?: string | null;
};

export type BrowserSettings = {
  direct_upload_parallelism: number;
  proxy_upload_parallelism: number;
  direct_download_parallelism: number;
  proxy_download_parallelism: number;
  other_operations_parallelism: number;
};

export type BrowserObjectsQuery = {
  query?: string;
  type?: "all" | "file" | "folder";
  storageClass?: string;
  recursive?: boolean;
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

export type ListObjectVersionsResponse = {
  prefix?: string | null;
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
  metadata: Record<string, string>;
  version_id?: string | null;
};

export type ObjectTag = { key: string; value: string };

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

export type ObjectAcl = {
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

export type PresignOperation = "get_object" | "put_object" | "delete_object" | "post_object";

export type PresignRequest = {
  key: string;
  operation: PresignOperation;
  expires_in?: number;
  content_type?: string | null;
  content_length?: number | null;
  version_id?: string | null;
};

export type PresignedUrl = {
  url: string;
  method: string;
  expires_in: number;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
};

export type MultipartUploadInitRequest = {
  key: string;
  content_type?: string | null;
  metadata?: Record<string, string>;
  tags?: ObjectTag[];
  acl?: string | null;
};

export type MultipartUploadInitResponse = {
  key: string;
  upload_id: string;
};

export type MultipartUploadItem = {
  key: string;
  upload_id: string;
  initiated?: string | null;
  storage_class?: string | null;
  owner?: string | null;
};

export type ListMultipartUploadsResponse = {
  uploads: MultipartUploadItem[];
  is_truncated: boolean;
  next_key?: string | null;
  next_upload_id?: string | null;
};

export type MultipartPart = {
  part_number: number;
  etag: string;
  size: number;
  last_modified?: string | null;
};

export type ListPartsResponse = {
  parts: MultipartPart[];
  is_truncated: boolean;
  next_part_number?: number | null;
};

export type PresignPartRequest = {
  key: string;
  part_number: number;
  expires_in?: number;
};

export type PresignPartResponse = {
  url: string;
  method: string;
  expires_in: number;
  headers?: Record<string, string>;
};

export type CompletedPart = { part_number: number; etag: string };

export type CompleteMultipartUploadRequest = {
  parts: CompletedPart[];
};

export type CopyObjectPayload = {
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

export type DeleteObjectEntry = {
  key: string;
  version_id?: string | null;
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

export async function listBrowserBuckets(accountId: S3AccountSelector): Promise<BrowserBucket[]> {
  const { data } = await client.get<BrowserBucket[]>("/manager/browser/buckets", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchBrowserSettings(accountId: S3AccountSelector): Promise<BrowserSettings> {
  const { data } = await client.get<BrowserSettings>("/manager/browser/settings", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function listBrowserObjects(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: { prefix?: string; continuationToken?: string | null; maxKeys?: number } & BrowserObjectsQuery
): Promise<ListBrowserObjectsResponse> {
  const params = withS3AccountParam(
    {
      prefix: options?.prefix ?? "",
      continuation_token: options?.continuationToken ?? undefined,
      max_keys: options?.maxKeys ?? undefined,
      query: options?.query?.trim() || undefined,
      item_type: options?.type && options.type !== "all" ? options.type : undefined,
      storage_class: options?.storageClass && options.storageClass !== "all" ? options.storageClass : undefined,
      recursive: options?.recursive ? true : undefined,
    },
    accountId
  );
  const { data } = await client.get<ListBrowserObjectsResponse>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/objects`,
    { params }
  );
  return data;
}

export async function getBucketCorsStatus(
  accountId: S3AccountSelector,
  bucketName: string,
  origin?: string
): Promise<BucketCorsStatus> {
  const params = withS3AccountParam(origin ? { origin } : undefined, accountId);
  const { data } = await client.get<BucketCorsStatus>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/cors`,
    { params }
  );
  return data;
}

export async function ensureBucketCors(
  accountId: S3AccountSelector,
  bucketName: string,
  origin: string
): Promise<BucketCorsStatus> {
  const { data } = await client.post<BucketCorsStatus>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/cors/ensure`,
    { origin },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function getStsStatus(accountId: S3AccountSelector): Promise<StsStatus> {
  const { data } = await client.get<StsStatus>("/manager/browser/sts", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function listObjectVersions(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: {
    prefix?: string;
    key?: string | null;
    keyMarker?: string | null;
    versionIdMarker?: string | null;
    maxKeys?: number;
  }
): Promise<ListObjectVersionsResponse> {
  const params = withS3AccountParam(
    {
      prefix: options?.prefix ?? "",
      key: options?.key ?? undefined,
      key_marker: options?.keyMarker ?? undefined,
      version_id_marker: options?.versionIdMarker ?? undefined,
      max_keys: options?.maxKeys ?? undefined,
    },
    accountId
  );
  const { data } = await client.get<ListObjectVersionsResponse>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/versions`,
    { params }
  );
  return data;
}

export async function fetchObjectMetadata(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  versionId?: string | null
): Promise<ObjectMetadata> {
  const params = withS3AccountParam({ key, version_id: versionId ?? undefined }, accountId);
  const { data } = await client.get<ObjectMetadata>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-meta`,
    { params }
  );
  return data;
}

export async function getObjectTags(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  versionId?: string | null
): Promise<ObjectTags> {
  const params = withS3AccountParam({ key, version_id: versionId ?? undefined }, accountId);
  const { data } = await client.get<ObjectTags>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-tags`,
    { params }
  );
  return data;
}

export async function updateObjectTags(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectTags
): Promise<ObjectTags> {
  const { data } = await client.put<ObjectTags>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-tags`,
    payload,
    {
      params: withS3AccountParam(undefined, accountId),
    }
  );
  return data;
}

export async function updateObjectMetadata(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectMetadataUpdate
): Promise<ObjectMetadata> {
  const { data } = await client.put<ObjectMetadata>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-meta`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updateObjectAcl(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectAcl
): Promise<ObjectAcl> {
  const { data } = await client.put<ObjectAcl>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-acl`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function getObjectLegalHold(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  versionId?: string | null
): Promise<ObjectLegalHold> {
  const params = withS3AccountParam({ key, version_id: versionId ?? undefined }, accountId);
  const { data } = await client.get<ObjectLegalHold>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-legal-hold`,
    { params }
  );
  return data;
}

export async function updateObjectLegalHold(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectLegalHold
): Promise<ObjectLegalHold> {
  const { data } = await client.put<ObjectLegalHold>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-legal-hold`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function getObjectRetention(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  versionId?: string | null
): Promise<ObjectRetention> {
  const params = withS3AccountParam({ key, version_id: versionId ?? undefined }, accountId);
  const { data } = await client.get<ObjectRetention>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-retention`,
    { params }
  );
  return data;
}

export async function updateObjectRetention(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectRetention
): Promise<ObjectRetention> {
  const { data } = await client.put<ObjectRetention>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-retention`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function restoreObject(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: ObjectRestoreRequest
): Promise<void> {
  await client.post(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/object-restore`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function presignObject(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: PresignRequest
): Promise<PresignedUrl> {
  const { data } = await client.post<PresignedUrl>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/presign`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function copyObject(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: CopyObjectPayload
): Promise<void> {
  await client.post(`/manager/browser/buckets/${encodeURIComponent(bucketName)}/copy`, payload, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function deleteObjects(
  accountId: S3AccountSelector,
  bucketName: string,
  objects: DeleteObjectEntry[]
): Promise<number> {
  const { data } = await client.post<{ deleted: number }>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/delete`,
    { objects },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data.deleted;
}

export async function createFolder(accountId: S3AccountSelector, bucketName: string, prefix: string): Promise<void> {
  await client.post(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/folders`,
    { prefix },
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function proxyUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  file: File,
  onUploadProgress?: (event: ProgressEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const form = new FormData();
  form.append("key", key);
  form.append("file", file);
  await client.post(`/manager/browser/buckets/${encodeURIComponent(bucketName)}/proxy-upload`, form, {
    params: withS3AccountParam(undefined, accountId),
    onUploadProgress,
    signal,
  });
}

export async function proxyDownload(
  accountId: S3AccountSelector,
  bucketName: string,
  key: string,
  signal?: AbortSignal
): Promise<Blob> {
  const { data } = await client.get(`/manager/browser/buckets/${encodeURIComponent(bucketName)}/proxy-download`, {
    params: withS3AccountParam({ key }, accountId),
    responseType: "blob",
    signal,
  });
  return data as Blob;
}

export async function initiateMultipartUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  payload: MultipartUploadInitRequest
): Promise<MultipartUploadInitResponse> {
  const { data } = await client.post<MultipartUploadInitResponse>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/multipart/initiate`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function listMultipartUploads(
  accountId: S3AccountSelector,
  bucketName: string,
  options?: { prefix?: string; keyMarker?: string | null; uploadIdMarker?: string | null; maxUploads?: number }
): Promise<ListMultipartUploadsResponse> {
  const params = withS3AccountParam(
    {
      prefix: options?.prefix ?? undefined,
      key_marker: options?.keyMarker ?? undefined,
      upload_id_marker: options?.uploadIdMarker ?? undefined,
      max_uploads: options?.maxUploads ?? undefined,
    },
    accountId
  );
  const { data } = await client.get<ListMultipartUploadsResponse>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/multipart`,
    { params }
  );
  return data;
}

export async function listParts(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  key: string,
  options?: { partNumberMarker?: number | null; maxParts?: number }
): Promise<ListPartsResponse> {
  const params = withS3AccountParam(
    {
      key,
      part_number_marker: options?.partNumberMarker ?? undefined,
      max_parts: options?.maxParts ?? undefined,
    },
    accountId
  );
  const { data } = await client.get<ListPartsResponse>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/parts`,
    { params }
  );
  return data;
}

export async function presignPart(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  payload: PresignPartRequest
): Promise<PresignPartResponse> {
  const { data } = await client.post<PresignPartResponse>(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/presign`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function completeMultipartUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  key: string,
  payload: CompleteMultipartUploadRequest
): Promise<void> {
  await client.post(
    `/manager/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}/complete`,
    payload,
    {
      params: withS3AccountParam({ key }, accountId),
    }
  );
}

export async function abortMultipartUpload(
  accountId: S3AccountSelector,
  bucketName: string,
  uploadId: string,
  key: string
): Promise<void> {
  await client.delete(`/manager/browser/buckets/${encodeURIComponent(bucketName)}/multipart/${encodeURIComponent(uploadId)}`, {
    params: withS3AccountParam({ key }, accountId),
  });
}

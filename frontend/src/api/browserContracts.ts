/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { StorageSpaceIconDescriptor } from "./storageSpaceIcons";

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

export type PaginatedBrowserBucketsResponse = {
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

export type BrowserObjectsQuery = {
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

export type ListObjectVersionsResponse = {
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

export type BrowserLazyColumnField =
  | "content_type"
  | "tags_count"
  | "metadata_count"
  | "cache_control"
  | "expires"
  | "restore_status";

export type BrowserObjectColumnValues = {
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

export type BrowserObjectColumnsResponse = {
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

export type CleanupObjectVersionsPayload = {
  prefix?: string;
  keep_last_n?: number;
  older_than_days?: number;
  delete_orphan_markers?: boolean;
};

export type CleanupObjectVersionsResponse = {
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


/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type BucketFeatureTone = "active" | "inactive" | "unknown";

export type BucketFeatureStatus = {
  state: string;
  tone: BucketFeatureTone;
};

export type BucketLifecycleRule = {
  id?: string | null;
  status?: string | null;
  prefix?: string | null;
};

export type BucketLifecycleConfig = {
  rules: Record<string, unknown>[];
};

export type BucketTag = {
  key: string;
  value: string;
};

export type BucketObjectLockConfiguration = {
  enabled?: boolean | null;
  mode?: string | null;
  days?: number | null;
  years?: number | null;
};

export type BucketNotificationConfiguration = {
  configuration: Record<string, unknown>;
};

export type BucketReplicationConfiguration = {
  configuration: Record<string, unknown>;
};

export type BucketLoggingConfiguration = {
  enabled?: boolean | null;
  target_bucket?: string | null;
  target_prefix?: string | null;
};

export type BucketPublicAccessBlock = {
  block_public_acls?: boolean | null;
  ignore_public_acls?: boolean | null;
  block_public_policy?: boolean | null;
  restrict_public_buckets?: boolean | null;
};

export type BucketVersioningStatus = {
  status?: string | null;
  enabled: boolean;
};

export type BucketWebsiteRedirectAllRequestsTo = {
  host_name: string;
  protocol?: string | null;
};

export type BucketWebsiteConfiguration = {
  index_document?: string | null;
  error_document?: string | null;
  redirect_all_requests_to?: BucketWebsiteRedirectAllRequestsTo | null;
  routing_rules?: Record<string, unknown>[];
};

type BucketAclGrantee = {
  type: string;
  id?: string | null;
  display_name?: string | null;
  uri?: string | null;
};

export type BucketAclGrant = {
  grantee: BucketAclGrantee;
  permission: string;
};

export type BucketAcl = {
  owner?: string | null;
  grants: BucketAclGrant[];
};

export type BucketProperties = {
  versioning_status?: string | null;
  object_lock_enabled?: boolean | null;
  object_lock?: BucketObjectLockConfiguration | null;
  public_access_block?: BucketPublicAccessBlock | null;
  lifecycle_rules: BucketLifecycleRule[];
  cors_rules?: Record<string, unknown>[] | null;
};

export type BucketQuotaUpdate = {
  max_size_gb?: number | null;
  max_size_unit?: string | null;
  max_objects?: number | null;
};

export type BucketPolicy = {
  policy: Record<string, unknown> | null;
};

export type BucketCors = {
  rules: Record<string, unknown>[];
};

export type BucketEncryptionConfiguration = {
  rules: Record<string, unknown>[];
};

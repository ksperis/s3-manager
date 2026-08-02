/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  sanitizeAdvancedFilter,
  type AdvancedFilterState,
  type FeatureKey,
  type TextMatchMode,
} from "./bucketOpsAdvancedFilterModel";

export type ColumnId =
  | "context_name"
  | "context_kind"
  | "endpoint_name"
  | "tenant"
  | "owner"
  | "owner_name"
  | "owner_suspended"
  | "owner_used_bytes"
  | "owner_object_count"
  | "owner_quota_max_size_bytes"
  | "owner_quota_max_objects"
  | "owner_quota_usage_size_percent"
  | "owner_quota_usage_object_percent"
  | "used_bytes"
  | "object_count"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "quota_usage_size_percent"
  | "quota_usage_object_percent"
  | "tags"
  | "ui_tags"
  | "versioning"
  | "object_lock"
  | "block_public_access"
  | "lifecycle_rules"
  | "static_website"
  | "bucket_policy"
  | "cors"
  | "access_logging"
  | "notifications"
  | "server_side_encryption"
  | "object_lock_mode"
  | "object_lock_retention_days"
  | "object_lock_retention_years"
  | "bpa_block_public_acls"
  | "bpa_ignore_public_acls"
  | "bpa_block_public_policy"
  | "bpa_restrict_public_buckets"
  | "cors_allowed_methods"
  | "cors_allowed_origins"
  | "logging_target_bucket"
  | "logging_target_prefix"
  | "website_index_document"
  | "website_error_document"
  | "website_redirect_host"
  | "website_routing_rule_count"
  | "policy_statement_count"
  | "policy_has_conditions"
  | "lifecycle_expiration_days"
  | "lifecycle_noncurrent_expiration_days"
  | "lifecycle_transition_days"
  | "lifecycle_abort_multipart_days"
  | "notification_topic_names"
  | "sse_algorithms"
  | "sse_kms_key_ids"
  | "quota_status";

export type SortField = "name" | "tenant" | "owner" | "used_bytes" | "object_count";
export type BucketListState = {
  filter: string;
  quickFilterMode: TextMatchMode;
  advancedApplied: AdvancedFilterState | null;
  tagFilters: string[];
  tagFilterMode: "any" | "all";
  page: number;
  pageSize: number;
  sort: { field: SortField; direction: "asc" | "desc" };
};

export const DEFAULT_PAGE_SIZE = 25;
export const DEFAULT_SORT: BucketListState["sort"] = { field: "name", direction: "asc" };
export const BUCKET_CORE_COLUMN_OPTIONS: Array<{ id: ColumnId; label: string }> = [
  { id: "context_name", label: "Context" },
  { id: "context_kind", label: "Kind" },
  { id: "endpoint_name", label: "Endpoint" },
  { id: "ui_tags", label: "UI tags" },
  { id: "tenant", label: "Tenant" },
  { id: "owner", label: "Owner" },
  { id: "owner_name", label: "Owner name" },
  { id: "owner_suspended", label: "Owner suspended" },
  { id: "used_bytes", label: "Used" },
  { id: "object_count", label: "Objects" },
  { id: "owner_used_bytes", label: "Owner used" },
  { id: "owner_object_count", label: "Owner objects" },
  { id: "tags", label: "S3 Tags" },
];
export const BUCKET_QUOTA_COLUMN_GROUPS: Array<{
  id: string;
  label: string;
  options: Array<{ id: ColumnId; label: string }>;
}> = [
  {
    id: "bucket_quota",
    label: "Bucket quota",
    options: [
      { id: "quota_max_size_bytes", label: "Quota" },
      { id: "quota_usage_size_percent", label: "Quota %" },
      { id: "quota_max_objects", label: "Object quota" },
      { id: "quota_usage_object_percent", label: "Object quota %" },
      { id: "quota_status", label: "Quota status" },
    ],
  },
  {
    id: "owner_quota",
    label: "Owner quota",
    options: [
      { id: "owner_quota_max_size_bytes", label: "Owner quota" },
      { id: "owner_quota_usage_size_percent", label: "Owner quota %" },
      { id: "owner_quota_max_objects", label: "Owner object quota" },
      { id: "owner_quota_usage_object_percent", label: "Owner object quota %" },
    ],
  },
];

export type FeatureDetailColumnOption = {
  id: ColumnId;
  label: string;
  feature: FeatureKey;
  include: string;
};
export const FEATURE_DETAIL_COLUMN_OPTIONS: FeatureDetailColumnOption[] = [
  {
    id: "object_lock_mode",
    label: "Object Lock mode",
    feature: "object_lock",
    include: "object_lock_mode",
  },
  {
    id: "object_lock_retention_days",
    label: "Object Lock retention days",
    feature: "object_lock",
    include: "object_lock_retention_days",
  },
  {
    id: "object_lock_retention_years",
    label: "Object Lock retention years",
    feature: "object_lock",
    include: "object_lock_retention_years",
  },
  {
    id: "bpa_block_public_acls",
    label: "BPA block public ACLs",
    feature: "block_public_access",
    include: "bpa_block_public_acls",
  },
  {
    id: "bpa_ignore_public_acls",
    label: "BPA ignore public ACLs",
    feature: "block_public_access",
    include: "bpa_ignore_public_acls",
  },
  {
    id: "bpa_block_public_policy",
    label: "BPA block public policy",
    feature: "block_public_access",
    include: "bpa_block_public_policy",
  },
  {
    id: "bpa_restrict_public_buckets",
    label: "BPA restrict public buckets",
    feature: "block_public_access",
    include: "bpa_restrict_public_buckets",
  },
  {
    id: "lifecycle_expiration_days",
    label: "Lifecycle expiration days",
    feature: "lifecycle_rules",
    include: "lifecycle_expiration_days",
  },
  {
    id: "lifecycle_noncurrent_expiration_days",
    label: "Lifecycle noncurrent expiration days",
    feature: "lifecycle_rules",
    include: "lifecycle_noncurrent_expiration_days",
  },
  {
    id: "lifecycle_transition_days",
    label: "Lifecycle transition days",
    feature: "lifecycle_rules",
    include: "lifecycle_transition_days",
  },
  {
    id: "lifecycle_abort_multipart_days",
    label: "Lifecycle abort multipart days",
    feature: "lifecycle_rules",
    include: "lifecycle_abort_multipart_days",
  },
  {
    id: "cors_allowed_methods",
    label: "CORS allowed methods",
    feature: "cors",
    include: "cors_allowed_methods",
  },
  {
    id: "cors_allowed_origins",
    label: "CORS allowed origins",
    feature: "cors",
    include: "cors_allowed_origins",
  },
  {
    id: "website_index_document",
    label: "Website index document",
    feature: "static_website",
    include: "website_index_document",
  },
  {
    id: "website_error_document",
    label: "Website error document",
    feature: "static_website",
    include: "website_error_document",
  },
  {
    id: "website_redirect_host",
    label: "Website redirect host",
    feature: "static_website",
    include: "website_redirect_host",
  },
  {
    id: "website_routing_rule_count",
    label: "Website routing rules",
    feature: "static_website",
    include: "website_routing_rule_count",
  },
  {
    id: "policy_statement_count",
    label: "Policy statements",
    feature: "bucket_policy",
    include: "policy_statement_count",
  },
  {
    id: "policy_has_conditions",
    label: "Policy has conditions",
    feature: "bucket_policy",
    include: "policy_has_conditions",
  },
  {
    id: "logging_target_bucket",
    label: "Logging target bucket",
    feature: "access_logging",
    include: "logging_target_bucket",
  },
  {
    id: "logging_target_prefix",
    label: "Logging target prefix",
    feature: "access_logging",
    include: "logging_target_prefix",
  },
  {
    id: "notification_topic_names",
    label: "Notification topic names",
    feature: "notifications",
    include: "notification_topic_names",
  },
  {
    id: "sse_algorithms",
    label: "SSE algorithms",
    feature: "server_side_encryption",
    include: "sse_algorithms",
  },
  {
    id: "sse_kms_key_ids",
    label: "SSE KMS key IDs",
    feature: "server_side_encryption",
    include: "sse_kms_key_ids",
  },
];

const CONTEXT_COLUMN_IDS: ColumnId[] = ["context_name", "context_kind", "endpoint_name"];
const STANDARD_COLUMN_IDS: ColumnId[] = [
  "tenant",
  "owner",
  "owner_name",
  "owner_suspended",
  "owner_used_bytes",
  "owner_object_count",
  "owner_quota_max_size_bytes",
  "owner_quota_max_objects",
  "owner_quota_usage_size_percent",
  "owner_quota_usage_object_percent",
  "used_bytes",
  "object_count",
  "quota_max_size_bytes",
  "quota_max_objects",
  "quota_usage_size_percent",
  "quota_usage_object_percent",
  "tags",
  "ui_tags",
  "versioning",
  "object_lock",
  "block_public_access",
  "lifecycle_rules",
  "static_website",
  "bucket_policy",
  "cors",
  "access_logging",
  "notifications",
  "server_side_encryption",
  "object_lock_mode",
  "object_lock_retention_days",
  "object_lock_retention_years",
  "bpa_block_public_acls",
  "bpa_ignore_public_acls",
  "bpa_block_public_policy",
  "bpa_restrict_public_buckets",
  "cors_allowed_methods",
  "cors_allowed_origins",
  "logging_target_bucket",
  "logging_target_prefix",
  "website_index_document",
  "website_error_document",
  "website_redirect_host",
  "website_routing_rule_count",
  "policy_statement_count",
  "policy_has_conditions",
  "lifecycle_expiration_days",
  "lifecycle_noncurrent_expiration_days",
  "lifecycle_transition_days",
  "lifecycle_abort_multipart_days",
  "notification_topic_names",
  "sse_algorithms",
  "sse_kms_key_ids",
  "quota_status",
];

export const loadVisibleColumns = (
  storageKey: string,
  defaultColumns: ColumnId[],
  includeContextColumns: boolean
): ColumnId[] => {
  if (typeof window === "undefined") return defaultColumns;
  const raw = localStorage.getItem(storageKey);
  if (!raw) return defaultColumns;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultColumns;
    const allowed = new Set(includeContextColumns ? [...CONTEXT_COLUMN_IDS, ...STANDARD_COLUMN_IDS] : STANDARD_COLUMN_IDS);
    const cleaned = parsed.filter((value): value is ColumnId => typeof value === "string" && allowed.has(value as ColumnId));
    return cleaned.length > 0 ? cleaned : defaultColumns;
  } catch {
    return defaultColumns;
  }
};

export const persistVisibleColumns = (storageKey: string, value: ColumnId[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey, JSON.stringify(value));
};

export const normalizeUiTagValues = (values: string[]) => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });
  return normalized;
};

const sanitizeStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];

const sanitizeSort = (value: unknown): BucketListState["sort"] => {
  if (!value || typeof value !== "object") return DEFAULT_SORT;
  const data = value as { field?: unknown; direction?: unknown };
  const allowedFields: SortField[] = ["name", "tenant", "owner", "used_bytes", "object_count"];
  return {
    field: allowedFields.includes(data.field as SortField) ? (data.field as SortField) : DEFAULT_SORT.field,
    direction: data.direction === "desc" ? "desc" : "asc",
  };
};

const sanitizePositiveInteger = (value: unknown, fallback: number, maximum?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  if (normalized < 1) return fallback;
  return maximum ? Math.min(normalized, maximum) : normalized;
};

const readStateStore = (storageKey: string): Record<string, unknown> => {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const loadBucketListState = (storageKey: string, endpointId?: number | null): BucketListState | null => {
  if (typeof window === "undefined" || !endpointId) return null;
  const stored = readStateStore(storageKey)[String(endpointId)];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const data = stored as Record<string, unknown>;
  return {
    filter: typeof data.filter === "string" ? data.filter : "",
    quickFilterMode: data.quickFilterMode === "exact" ? "exact" : "contains",
    advancedApplied: data.advancedApplied ? sanitizeAdvancedFilter(data.advancedApplied) : null,
    tagFilters: normalizeUiTagValues(sanitizeStringArray(data.tagFilters)),
    tagFilterMode: data.tagFilterMode === "all" ? "all" : "any",
    page: sanitizePositiveInteger(data.page, 1),
    pageSize: sanitizePositiveInteger(data.pageSize, DEFAULT_PAGE_SIZE, 200),
    sort: sanitizeSort(data.sort),
  };
};

export const persistBucketListState = (
  storageKey: string,
  endpointId: number | null | undefined,
  value: BucketListState
) => {
  if (typeof window === "undefined" || !endpointId) return;
  const store = readStateStore(storageKey);
  store[String(endpointId)] = value;
  localStorage.setItem(storageKey, JSON.stringify(store));
};

export const parseUiTags = (value: string) => normalizeUiTagValues(value.split(","));
export const mergeUiTags = (existing: string[], incoming: string[]) =>
  normalizeUiTagValues([...existing, ...incoming]);

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ExecutionContext } from "../../api/executionContexts";
import {
  buildFeatureDetailRules,
  clearFeatureDetailField,
  defaultFeatureDetailFilters,
  hasFeatureDetailFilters,
  notificationFeatureDetailFilterKeys,
  sanitizeFeatureDetailFilters,
  sseFeatureDetailFilterKeys,
  type FeatureDetailFilterKey,
  type FeatureDetailFilters,
  type NumericComparisonOpUi,
} from "../cephAdmin/filtering/bucketAdvancedFilter";
import {
  buildTextFieldRules,
  parseExactListInput,
} from "../cephAdmin/filtering/advancedFilterShared";

export type FeatureKey =
  | "versioning"
  | "object_lock"
  | "block_public_access"
  | "lifecycle_rules"
  | "static_website"
  | "bucket_policy"
  | "cors"
  | "access_logging"
  | "notifications"
  | "server_side_encryption";
export type FeatureFilterState = "any" | "enabled" | "disabled" | "suspended" | "disabled_or_suspended";
export type TextMatchMode = "contains" | "exact";
export type BooleanFilterState = "any" | "true" | "false";
type StorageOpsContextFilterKind = "any" | "account" | "connection" | "s3_user";
export type AdvancedNumericField =
  | "minUsedBytes"
  | "maxUsedBytes"
  | "minObjects"
  | "maxObjects"
  | "minQuotaBytes"
  | "maxQuotaBytes"
  | "minQuotaObjects"
  | "maxQuotaObjects"
  | "minQuotaUsageSizePercent"
  | "maxQuotaUsageSizePercent"
  | "minQuotaUsageObjectPercent"
  | "maxQuotaUsageObjectPercent"
  | "minOwnerUsedBytes"
  | "maxOwnerUsedBytes"
  | "minOwnerObjects"
  | "maxOwnerObjects"
  | "minOwnerQuotaBytes"
  | "maxOwnerQuotaBytes"
  | "minOwnerQuotaObjects"
  | "maxOwnerQuotaObjects"
  | "minOwnerQuotaUsageSizePercent"
  | "maxOwnerQuotaUsageSizePercent"
  | "minOwnerQuotaUsageObjectPercent"
  | "maxOwnerQuotaUsageObjectPercent";
export type OwnerNameScope = "any" | "account" | "user";
export type AdvancedTextOrNumericField = "tenant" | "owner" | "ownerName" | "s3Tags" | AdvancedNumericField;
export type ActiveFilterRemoveAction =
  | { type: "quick" }
  | { type: "tag_mode" }
  | { type: "tag"; tag: string }
  | { type: "advanced_context_ids" }
  | { type: "advanced_endpoint_names" }
  | { type: "advanced_text"; field: "tenant" | "owner" | "ownerName" | "s3Tags" }
  | { type: "advanced_owner_suspended" }
  | { type: "advanced_owner_scope" }
  | { type: "advanced_numeric"; field: AdvancedNumericField }
  | { type: "advanced_feature"; feature: FeatureKey }
  | { type: "advanced_feature_detail"; field: FeatureDetailFilterKey };
export type ActiveFilterSummaryItem = {
  id: string;
  label: string;
  remove: ActiveFilterRemoveAction;
};
export type AdvancedFilterSecondarySectionId = "metrics" | "featureStates" | "featureDetails";
export type AdvancedFilterSecondarySectionState = Record<AdvancedFilterSecondarySectionId, boolean>;

export type AdvancedFilterState = {
  contextIds: string[];
  endpointNames: string[];
  tenant: string;
  tenantMatchMode: TextMatchMode;
  owner: string;
  ownerMatchMode: TextMatchMode;
  ownerName: string;
  ownerNameMatchMode: TextMatchMode;
  ownerNameScope: OwnerNameScope;
  ownerSuspended: BooleanFilterState;
  s3Tags: string;
  s3TagsMatchMode: TextMatchMode;
  minUsedBytes: string;
  maxUsedBytes: string;
  minObjects: string;
  maxObjects: string;
  minQuotaBytes: string;
  maxQuotaBytes: string;
  minQuotaObjects: string;
  maxQuotaObjects: string;
  minQuotaUsageSizePercent: string;
  maxQuotaUsageSizePercent: string;
  minQuotaUsageObjectPercent: string;
  maxQuotaUsageObjectPercent: string;
  minOwnerUsedBytes: string;
  maxOwnerUsedBytes: string;
  minOwnerObjects: string;
  maxOwnerObjects: string;
  minOwnerQuotaBytes: string;
  maxOwnerQuotaBytes: string;
  minOwnerQuotaObjects: string;
  maxOwnerQuotaObjects: string;
  minOwnerQuotaUsageSizePercent: string;
  maxOwnerQuotaUsageSizePercent: string;
  minOwnerQuotaUsageObjectPercent: string;
  maxOwnerQuotaUsageObjectPercent: string;
  features: Record<FeatureKey, FeatureFilterState>;
  featureDetails: FeatureDetailFilters;
};

export const formatStorageOpsContextKindLabel = (
  kind: StorageOpsContextFilterKind | ExecutionContext["kind"]
) => {
  if (kind === "account") return "Account";
  if (kind === "connection") return "Connection";
  if (kind === "s3_user" || kind === "legacy_user") return "S3 user";
  return "Any";
};

export const toStorageOpsContextKind = (kind: ExecutionContext["kind"]): StorageOpsContextFilterKind => {
  if (kind === "legacy_user") return "s3_user";
  if (kind === "portal_account") return "account";
  return kind;
};

export const defaultAdvancedFilter: AdvancedFilterState = {
  contextIds: [],
  endpointNames: [],
  tenant: "",
  tenantMatchMode: "contains",
  owner: "",
  ownerMatchMode: "contains",
  ownerName: "",
  ownerNameMatchMode: "contains",
  ownerNameScope: "any",
  ownerSuspended: "any",
  s3Tags: "",
  s3TagsMatchMode: "contains",
  minUsedBytes: "",
  maxUsedBytes: "",
  minObjects: "",
  maxObjects: "",
  minQuotaBytes: "",
  maxQuotaBytes: "",
  minQuotaObjects: "",
  maxQuotaObjects: "",
  minQuotaUsageSizePercent: "",
  maxQuotaUsageSizePercent: "",
  minQuotaUsageObjectPercent: "",
  maxQuotaUsageObjectPercent: "",
  minOwnerUsedBytes: "",
  maxOwnerUsedBytes: "",
  minOwnerObjects: "",
  maxOwnerObjects: "",
  minOwnerQuotaBytes: "",
  maxOwnerQuotaBytes: "",
  minOwnerQuotaObjects: "",
  maxOwnerQuotaObjects: "",
  minOwnerQuotaUsageSizePercent: "",
  maxOwnerQuotaUsageSizePercent: "",
  minOwnerQuotaUsageObjectPercent: "",
  maxOwnerQuotaUsageObjectPercent: "",
  features: {
    versioning: "any",
    object_lock: "any",
    block_public_access: "any",
    lifecycle_rules: "any",
    static_website: "any",
    bucket_policy: "any",
    cors: "any",
    access_logging: "any",
    notifications: "any",
    server_side_encryption: "any",
  },
  featureDetails: { ...defaultFeatureDetailFilters },
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  versioning: "Versioning",
  object_lock: "Object Lock",
  block_public_access: "Block public access",
  lifecycle_rules: "Lifecycle rules",
  static_website: "Static website",
  bucket_policy: "Bucket policy",
  cors: "CORS",
  access_logging: "Access logging",
  notifications: "Notifications",
  server_side_encryption: "Server-side encryption",
};

export const FEATURE_STATE_OPTIONS: Array<{ id: FeatureKey; label: string }> = Object.entries(FEATURE_LABELS).map(
  ([id, label]) => ({ id: id as FeatureKey, label })
);
export const BOOLEAN_FILTER_OPTIONS: Array<{ value: BooleanFilterState; label: string }> = [
  { value: "any", label: "Any" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
export const NUMERIC_FILTER_OPTIONS: NumericComparisonOpUi[] = ["=", "!=", ">", ">=", "<", "<="];

export const formatFeatureFilterStateLabel = (state: FeatureFilterState) => {
  if (state === "disabled_or_suspended") return "Disabled or Suspended";
  return state.charAt(0).toUpperCase() + state.slice(1);
};

export const buildAdvancedFilterSecondarySectionState = (
  activeCounts: Partial<Record<AdvancedFilterSecondarySectionId, number>> = {}
): AdvancedFilterSecondarySectionState => ({
  metrics: Boolean(activeCounts.metrics),
  featureStates: Boolean(activeCounts.featureStates),
  featureDetails: Boolean(activeCounts.featureDetails),
});

export const parseS3TagExpressions = (value: string): string[] => {
  const seen = new Set<string>();
  const expressions: string[] = [];
  value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      expressions.push(item);
    });
  return expressions;
};

export const BUCKET_STATS_NUMERIC_FILTER_FIELDS: AdvancedNumericField[] = [
  "minUsedBytes",
  "maxUsedBytes",
  "minObjects",
  "maxObjects",
  "minQuotaBytes",
  "maxQuotaBytes",
  "minQuotaObjects",
  "maxQuotaObjects",
  "minQuotaUsageSizePercent",
  "maxQuotaUsageSizePercent",
  "minQuotaUsageObjectPercent",
  "maxQuotaUsageObjectPercent",
];
export const OWNER_QUOTA_NUMERIC_FILTER_FIELDS: AdvancedNumericField[] = [
  "minOwnerQuotaBytes",
  "maxOwnerQuotaBytes",
  "minOwnerQuotaObjects",
  "maxOwnerQuotaObjects",
];
export const OWNER_USAGE_NUMERIC_FILTER_FIELDS: AdvancedNumericField[] = [
  "minOwnerUsedBytes",
  "maxOwnerUsedBytes",
  "minOwnerObjects",
  "maxOwnerObjects",
  "minOwnerQuotaUsageSizePercent",
  "maxOwnerQuotaUsageSizePercent",
  "minOwnerQuotaUsageObjectPercent",
  "maxOwnerQuotaUsageObjectPercent",
];

export const serializeS3TagExpressions = (values: string[]) =>
  values
    .map((value) => value.toLowerCase())
    .sort((a, b) => a.localeCompare(b))
    .join("\u001f");

export const normalizeAdvancedSelectionValues = (values?: string[] | null) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  values.forEach((value) => {
    const id = value.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
};

export const serializeAdvancedSelectionValues = (values?: string[] | null) =>
  normalizeAdvancedSelectionValues(values)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join("\u001f");

const addExactStringListRule = (rules: Array<Record<string, unknown>>, field: string, values: string[]) => {
  if (values.length === 1) {
    rules.push({ field, op: "eq", value: values[0] });
  } else if (values.length > 1) {
    rules.push({ field, op: "in", value: values });
  }
};

type NumericRule = {
  stateField: AdvancedNumericField;
  apiField: string;
  op: "gte" | "lte";
  requiresStats: boolean;
};

const numericRules: NumericRule[] = [
  { stateField: "minUsedBytes", apiField: "used_bytes", op: "gte", requiresStats: true },
  { stateField: "maxUsedBytes", apiField: "used_bytes", op: "lte", requiresStats: true },
  { stateField: "minObjects", apiField: "object_count", op: "gte", requiresStats: true },
  { stateField: "maxObjects", apiField: "object_count", op: "lte", requiresStats: true },
  { stateField: "minQuotaBytes", apiField: "quota_max_size_bytes", op: "gte", requiresStats: true },
  { stateField: "maxQuotaBytes", apiField: "quota_max_size_bytes", op: "lte", requiresStats: true },
  { stateField: "minQuotaObjects", apiField: "quota_max_objects", op: "gte", requiresStats: true },
  { stateField: "maxQuotaObjects", apiField: "quota_max_objects", op: "lte", requiresStats: true },
  { stateField: "minQuotaUsageSizePercent", apiField: "quota_usage_size_percent", op: "gte", requiresStats: true },
  { stateField: "maxQuotaUsageSizePercent", apiField: "quota_usage_size_percent", op: "lte", requiresStats: true },
  { stateField: "minQuotaUsageObjectPercent", apiField: "quota_usage_object_percent", op: "gte", requiresStats: true },
  { stateField: "maxQuotaUsageObjectPercent", apiField: "quota_usage_object_percent", op: "lte", requiresStats: true },
  { stateField: "minOwnerUsedBytes", apiField: "owner_used_bytes", op: "gte", requiresStats: true },
  { stateField: "maxOwnerUsedBytes", apiField: "owner_used_bytes", op: "lte", requiresStats: true },
  { stateField: "minOwnerObjects", apiField: "owner_object_count", op: "gte", requiresStats: true },
  { stateField: "maxOwnerObjects", apiField: "owner_object_count", op: "lte", requiresStats: true },
  { stateField: "minOwnerQuotaUsageSizePercent", apiField: "owner_quota_usage_size_percent", op: "gte", requiresStats: true },
  { stateField: "maxOwnerQuotaUsageSizePercent", apiField: "owner_quota_usage_size_percent", op: "lte", requiresStats: true },
  { stateField: "minOwnerQuotaUsageObjectPercent", apiField: "owner_quota_usage_object_percent", op: "gte", requiresStats: true },
  { stateField: "maxOwnerQuotaUsageObjectPercent", apiField: "owner_quota_usage_object_percent", op: "lte", requiresStats: true },
  { stateField: "minOwnerQuotaBytes", apiField: "owner_quota_max_size_bytes", op: "gte", requiresStats: false },
  { stateField: "maxOwnerQuotaBytes", apiField: "owner_quota_max_size_bytes", op: "lte", requiresStats: false },
  { stateField: "minOwnerQuotaObjects", apiField: "owner_quota_max_objects", op: "gte", requiresStats: false },
  { stateField: "maxOwnerQuotaObjects", apiField: "owner_quota_max_objects", op: "lte", requiresStats: false },
];

export const buildAdvancedFilterPayload = (
  basicFilter: string,
  basicFilterMode: TextMatchMode,
  advanced: AdvancedFilterState | null,
  taggedBuckets: string[] | null,
  isStorageOps: boolean = false,
  allowStatsFilters: boolean = true,
  featureSupport: Partial<Record<FeatureKey, boolean>> = {}
) => {
  const parsedBasicFilter = parseExactListInput(basicFilter);
  const trimmedFilter = parsedBasicFilter.values[0] ?? "";
  if (!advanced && !taggedBuckets) {
    if (parsedBasicFilter.values.length === 0) return undefined;
    if (!parsedBasicFilter.listProvided && basicFilterMode === "contains") return trimmedFilter;
    if (parsedBasicFilter.listProvided && parsedBasicFilter.values.length > 1) {
      return JSON.stringify({ match: "all", rules: [{ field: "name", op: "in", value: parsedBasicFilter.values }] });
    }
    return JSON.stringify({ match: "all", rules: [{ field: "name", op: "eq", value: trimmedFilter }] });
  }

  const rules: Array<Record<string, unknown>> = [];
  rules.push(...buildTextFieldRules("name", basicFilter, basicFilterMode));
  if (advanced) {
    if (isStorageOps) {
      addExactStringListRule(rules, "context_id", normalizeAdvancedSelectionValues(advanced.contextIds));
      addExactStringListRule(rules, "endpoint_name", normalizeAdvancedSelectionValues(advanced.endpointNames));
    }
    rules.push(...buildTextFieldRules("tenant", advanced.tenant, advanced.tenantMatchMode));
    rules.push(...buildTextFieldRules("owner", advanced.owner, advanced.ownerMatchMode));
    rules.push(...buildTextFieldRules("owner_name", advanced.ownerName, advanced.ownerNameMatchMode));
    if (advanced.ownerNameScope !== "any") rules.push({ field: "owner_kind", op: "eq", value: advanced.ownerNameScope });
    if (advanced.ownerSuspended !== "any") {
      rules.push({ field: "owner_suspended", op: "eq", value: advanced.ownerSuspended === "true" });
    }
    const tagExpressions = parseS3TagExpressions(advanced.s3Tags);
    if (tagExpressions.length > 0) {
      const parsedS3Tags = parseExactListInput(advanced.s3Tags);
      const forceExact = parsedS3Tags.listProvided && parsedS3Tags.values.length > 0;
      const tagOp = forceExact || advanced.s3TagsMatchMode === "exact" ? "eq" : "contains";
      tagExpressions.forEach((expression) => rules.push({ field: "tag", op: tagOp, value: expression }));
    }
    numericRules.forEach(({ stateField, apiField, op, requiresStats }) => {
      if (requiresStats && !allowStatsFilters) return;
      const raw = advanced[stateField].trim();
      if (!raw) return;
      const value = Number(raw);
      if (Number.isFinite(value)) rules.push({ field: apiField, op, value });
    });
    (Object.keys(advanced.features) as FeatureKey[]).forEach((key) => {
      if (featureSupport[key] === false || advanced.features[key] === "any") return;
      rules.push({ feature: key, state: advanced.features[key] });
    });
    rules.push(...buildFeatureDetailRules(advanced.featureDetails, featureSupport));
  }
  if (taggedBuckets) {
    rules.push({ field: isStorageOps ? "bucket_identity" : "name", op: "in", value: taggedBuckets });
  }
  if (rules.length === 0) return trimmedFilter || undefined;
  return JSON.stringify({ match: "all", rules });
};

export const hasAdvancedFilters = (
  advanced: AdvancedFilterState | null,
  isStorageOps: boolean = false,
  allowStatsFilters: boolean = true,
  featureSupport: Partial<Record<FeatureKey, boolean>> = {}
) => {
  if (!advanced) return false;
  if (
    isStorageOps &&
    (normalizeAdvancedSelectionValues(advanced.contextIds).length > 0 ||
      normalizeAdvancedSelectionValues(advanced.endpointNames).length > 0)
  ) return true;
  if (
    advanced.tenant.trim() ||
    advanced.owner.trim() ||
    advanced.ownerName.trim() ||
    advanced.ownerNameScope !== "any" ||
    advanced.ownerSuspended !== "any" ||
    parseS3TagExpressions(advanced.s3Tags).length > 0
  ) return true;
  if (numericRules.some(({ stateField, requiresStats }) => (!requiresStats || allowStatsFilters) && advanced[stateField])) {
    return true;
  }
  if (
    (Object.keys(advanced.features) as FeatureKey[]).some(
      (feature) => featureSupport[feature] !== false && advanced.features[feature] !== "any"
    )
  ) return true;
  return hasFeatureDetailFilters(advanced.featureDetails, featureSupport);
};

const sanitizeStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];

export const sanitizeAdvancedFilter = (value: unknown): AdvancedFilterState => {
  if (!value || typeof value !== "object") return defaultAdvancedFilter;
  const data = value as Partial<AdvancedFilterState>;
  const features: Record<FeatureKey, FeatureFilterState> = { ...defaultAdvancedFilter.features };
  if (data.features && typeof data.features === "object") {
    const rawFeatures = data.features as Record<string, unknown>;
    (Object.keys(features) as FeatureKey[]).forEach((key) => {
      const raw = rawFeatures[key];
      if (["any", "enabled", "disabled", "suspended", "disabled_or_suspended"].includes(String(raw))) {
        features[key] = raw as FeatureFilterState;
      }
    });
  }
  const safeString = (input: unknown) => (typeof input === "string" ? input : "");
  const parseMatchMode = (input: unknown): TextMatchMode => (input === "exact" ? "exact" : "contains");
  const parseOwnerNameScope = (input: unknown): OwnerNameScope =>
    input === "account" || input === "user" ? input : "any";
  const parseBooleanFilterState = (input: unknown): BooleanFilterState =>
    input === "true" || input === "false" ? input : "any";
  const sanitized = {
    ...defaultAdvancedFilter,
    contextIds: normalizeAdvancedSelectionValues(sanitizeStringArray(data.contextIds)),
    endpointNames: normalizeAdvancedSelectionValues(sanitizeStringArray(data.endpointNames)),
    tenant: safeString(data.tenant),
    tenantMatchMode: parseMatchMode(data.tenantMatchMode),
    owner: safeString(data.owner),
    ownerMatchMode: parseMatchMode(data.ownerMatchMode),
    ownerName: safeString(data.ownerName),
    ownerNameMatchMode: parseMatchMode(data.ownerNameMatchMode),
    ownerNameScope: parseOwnerNameScope(data.ownerNameScope),
    ownerSuspended: parseBooleanFilterState(data.ownerSuspended),
    s3Tags: safeString(data.s3Tags),
    s3TagsMatchMode: parseMatchMode(data.s3TagsMatchMode),
    features,
    featureDetails: sanitizeFeatureDetailFilters(data.featureDetails),
  };
  numericRules.forEach(({ stateField }) => {
    sanitized[stateField] = safeString(data[stateField]);
  });
  return sanitized;
};

export const stripUnsupportedAdvancedFeatureFilters = (
  value: AdvancedFilterState,
  featureSupport: Partial<Record<FeatureKey, boolean>>
): AdvancedFilterState => {
  let changed = false;
  const nextFeatures: Record<FeatureKey, FeatureFilterState> = { ...value.features };
  (Object.keys(nextFeatures) as FeatureKey[]).forEach((feature) => {
    if (featureSupport[feature] !== false || nextFeatures[feature] === "any") return;
    nextFeatures[feature] = "any";
    changed = true;
  });
  let nextFeatureDetails = value.featureDetails;
  const clearUnsupportedFields = (supported: boolean, fields: FeatureDetailFilterKey[]) => {
    if (supported) return;
    fields.forEach((key) => {
      if (nextFeatureDetails[key] === defaultFeatureDetailFilters[key]) return;
      nextFeatureDetails = clearFeatureDetailField(nextFeatureDetails, key);
      changed = true;
    });
  };
  clearUnsupportedFields(featureSupport.notifications !== false, notificationFeatureDetailFilterKeys);
  clearUnsupportedFields(featureSupport.server_side_encryption !== false, sseFeatureDetailFilterKeys);
  return changed ? { ...value, features: nextFeatures, featureDetails: nextFeatureDetails } : value;
};

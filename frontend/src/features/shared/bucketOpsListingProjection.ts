/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  BUCKET_STATS_NUMERIC_FILTER_FIELDS,
  OWNER_USAGE_NUMERIC_FILTER_FIELDS,
  type AdvancedFilterState,
  type FeatureKey,
} from "./bucketOpsAdvancedFilterModel";
import {
  FEATURE_DETAIL_COLUMN_OPTIONS,
  type ColumnId,
  type SortField,
} from "./bucketOpsListState";

const OWNER_QUOTA_COLUMN_IDS: ColumnId[] = [
  "owner_quota_max_size_bytes",
  "owner_quota_max_objects",
  "owner_quota_usage_size_percent",
  "owner_quota_usage_object_percent",
];

const OWNER_USAGE_COLUMN_IDS: ColumnId[] = [
  "owner_used_bytes",
  "owner_object_count",
  "owner_quota_usage_size_percent",
  "owner_quota_usage_object_percent",
];

const STATS_COLUMN_IDS: ColumnId[] = [
  "used_bytes",
  "object_count",
  "quota_max_size_bytes",
  "quota_max_objects",
  "quota_usage_size_percent",
  "quota_usage_object_percent",
  "owner_used_bytes",
  "owner_object_count",
  "owner_quota_usage_size_percent",
  "owner_quota_usage_object_percent",
  "quota_status",
];

type BuildBucketOpsListingProjectionOptions = {
  advancedApplied: AdvancedFilterState | null;
  featureColumnIds: FeatureKey[];
  isStorageOps: boolean;
  sortField: SortField;
  usageFeatureEnabled: boolean;
  visibleColumns: ColumnId[];
};

function anyVisible(
  visibleColumns: ReadonlySet<ColumnId>,
  columnIds: ColumnId[],
): boolean {
  return columnIds.some((columnId) => visibleColumns.has(columnId));
}

function advancedStatsAreRequired(
  advancedApplied: AdvancedFilterState | null,
  usageFeatureEnabled: boolean,
): boolean {
  if (!usageFeatureEnabled || !advancedApplied) return false;
  return [
    ...BUCKET_STATS_NUMERIC_FILTER_FIELDS,
    ...OWNER_USAGE_NUMERIC_FILTER_FIELDS,
  ].some((field) => advancedApplied[field].trim().length > 0);
}

export function buildBucketOpsListingProjection({
  advancedApplied,
  featureColumnIds,
  isStorageOps,
  sortField,
  usageFeatureEnabled,
  visibleColumns,
}: BuildBucketOpsListingProjectionOptions) {
  const visibleColumnSet = new Set(visibleColumns);
  const includeParams: string[] = [];
  const includeSet = new Set<string>();
  const addInclude = (include: string) => {
    if (includeSet.has(include)) return;
    includeSet.add(include);
    includeParams.push(include);
  };

  if (visibleColumnSet.has("owner_name")) addInclude("owner_name");
  if (visibleColumnSet.has("owner_suspended")) addInclude("owner_suspended");
  if (anyVisible(visibleColumnSet, OWNER_QUOTA_COLUMN_IDS)) {
    addInclude("owner_quota");
  }
  if (anyVisible(visibleColumnSet, OWNER_USAGE_COLUMN_IDS)) {
    addInclude("owner_quota_usage");
  }
  if (visibleColumnSet.has("tags")) addInclude("tags");
  featureColumnIds.forEach((feature) => {
    if (visibleColumnSet.has(feature)) addInclude(feature);
  });
  FEATURE_DETAIL_COLUMN_OPTIONS.forEach((column) => {
    if (visibleColumnSet.has(column.id)) addInclude(column.include);
  });

  const advancedStatsRequired = advancedStatsAreRequired(
    advancedApplied,
    usageFeatureEnabled,
  );
  const visibleStatsRequired =
    usageFeatureEnabled && anyVisible(visibleColumnSet, STATS_COLUMN_IDS);
  const requiresStats = advancedStatsRequired || visibleStatsRequired;
  const sortRequiresStats =
    sortField === "used_bytes" || sortField === "object_count";
  const baseRequiresStats = isStorageOps
    ? usageFeatureEnabled && (advancedStatsRequired || sortRequiresStats)
    : usageFeatureEnabled;
  const exportWithStats =
    usageFeatureEnabled && (baseRequiresStats || visibleStatsRequired);

  const detailLoadingColumnIds = new Set<string>(includeParams);
  if (requiresStats && !baseRequiresStats) {
    STATS_COLUMN_IDS.forEach((columnId) =>
      detailLoadingColumnIds.add(columnId),
    );
  }
  if (visibleColumnSet.has("owner_quota_max_size_bytes")) {
    detailLoadingColumnIds.add("owner_quota_max_size_bytes");
  }
  if (visibleColumnSet.has("owner_quota_max_objects")) {
    detailLoadingColumnIds.add("owner_quota_max_objects");
  }
  if (visibleColumnSet.has("owner_used_bytes")) {
    detailLoadingColumnIds.add("owner_used_bytes");
  }
  if (visibleColumnSet.has("owner_object_count")) {
    detailLoadingColumnIds.add("owner_object_count");
  }
  if (visibleColumnSet.has("owner_quota_usage_size_percent")) {
    detailLoadingColumnIds.add("owner_quota_usage_size_percent");
  }
  if (visibleColumnSet.has("owner_quota_usage_object_percent")) {
    detailLoadingColumnIds.add("owner_quota_usage_object_percent");
  }
  if (visibleColumnSet.has("owner_suspended")) {
    detailLoadingColumnIds.add("owner_suspended");
  }

  return {
    baseRequiresStats,
    detailLoadingColumnIds,
    exportWithStats,
    includeParams,
    requiresStats,
  };
}

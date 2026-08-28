/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminBucket } from "../../api/cephAdmin";
import { formatBytes, formatNumber } from "../../utils/format";
import type { FeatureKey } from "./bucketOpsAdvancedFilterModel";
import {
  FEATURE_DETAIL_COLUMN_OPTIONS,
  type ColumnId,
} from "./bucketOpsListState";
import {
  csvEscape,
  formatBucketColumnDetail,
  formatOptionalBytes,
  formatOptionalCount,
  formatOwnerSuspended,
  formatQuotaBytes,
  formatQuotaObjects,
  formatQuotaUsageValue,
  getBucketDisplayName,
  isBucketQuotaConfigured,
} from "./bucketOpsPresentation";

type BucketExportColumn = {
  id: string;
  label: string;
  getValue: (bucket: CephAdminBucket) => string;
};

export type BucketExportFeatureColumn = {
  id: FeatureKey;
  key: FeatureKey;
  label: string;
};

const contextKindLabel = (kind?: string | null) => {
  if (kind === "account") return "Account";
  if (kind === "connection") return "Connection";
  if (kind === "s3_user") return "S3 user";
  return "-";
};

const formatS3Tags = (bucket: CephAdminBucket) => {
  const tags = Array.isArray(bucket.tags) ? bucket.tags : [];
  if (tags.length === 0) return "-";
  return tags
    .filter((tag) => (tag.key ?? "").trim())
    .map((tag) => `${tag.key}=${tag.value}`)
    .join(", ");
};

const STATIC_BUCKET_EXPORT_COLUMNS: Partial<
  Record<ColumnId, Omit<BucketExportColumn, "id">>
> = {
  context_name: {
    label: "Context",
    getValue: (bucket) => bucket.context_name ?? "-",
  },
  endpoint_name: {
    label: "Endpoint",
    getValue: (bucket) => (bucket as { endpoint_name?: string | null }).endpoint_name ?? "-",
  },
  context_kind: {
    label: "Kind",
    getValue: (bucket) => contextKindLabel(bucket.context_kind),
  },
  tenant: { label: "Tenant", getValue: (bucket) => bucket.tenant ?? "-" },
  owner: { label: "Owner", getValue: (bucket) => bucket.owner ?? "-" },
  owner_name: { label: "Owner name", getValue: (bucket) => bucket.owner_name ?? "-" },
  owner_suspended: {
    label: "Owner suspended",
    getValue: (bucket) => formatOwnerSuspended(bucket.owner_suspended),
  },
  owner_used_bytes: {
    label: "Owner used",
    getValue: (bucket) => formatOptionalBytes(bucket.owner_used_bytes),
  },
  owner_quota_max_size_bytes: {
    label: "Owner quota",
    getValue: (bucket) => formatQuotaBytes(bucket.owner_quota_max_size_bytes),
  },
  owner_quota_usage_size_percent: {
    label: "Owner quota %",
    getValue: (bucket) =>
      formatQuotaUsageValue(bucket.owner_used_bytes, bucket.owner_quota_max_size_bytes),
  },
  owner_object_count: {
    label: "Owner objects",
    getValue: (bucket) => formatOptionalCount(bucket.owner_object_count),
  },
  owner_quota_max_objects: {
    label: "Owner object quota",
    getValue: (bucket) => formatQuotaObjects(bucket.owner_quota_max_objects),
  },
  owner_quota_usage_object_percent: {
    label: "Owner object quota %",
    getValue: (bucket) =>
      formatQuotaUsageValue(bucket.owner_object_count, bucket.owner_quota_max_objects),
  },
  used_bytes: { label: "Used", getValue: (bucket) => formatBytes(bucket.used_bytes) },
  quota_max_size_bytes: {
    label: "Quota",
    getValue: (bucket) => formatQuotaBytes(bucket.quota_max_size_bytes),
  },
  quota_usage_size_percent: {
    label: "Quota %",
    getValue: (bucket) =>
      formatQuotaUsageValue(bucket.used_bytes, bucket.quota_max_size_bytes),
  },
  object_count: { label: "Objects", getValue: (bucket) => formatNumber(bucket.object_count) },
  quota_max_objects: {
    label: "Object quota",
    getValue: (bucket) => formatQuotaObjects(bucket.quota_max_objects),
  },
  quota_usage_object_percent: {
    label: "Object quota %",
    getValue: (bucket) =>
      formatQuotaUsageValue(bucket.object_count, bucket.quota_max_objects),
  },
  tags: { label: "Tags", getValue: formatS3Tags },
};

type BuildBucketExportColumnsInput = {
  columnIds: readonly ColumnId[];
  featureColumns: readonly BucketExportFeatureColumn[];
  isStorageOps: boolean;
  useExplicitBucketName: boolean;
};

export function buildBucketExportColumns({
  columnIds,
  featureColumns,
  isStorageOps,
  useExplicitBucketName,
}: BuildBucketExportColumnsInput): BucketExportColumn[] {
  const featureColumnById = new Map(featureColumns.map((column) => [column.id, column]));
  const detailColumnById = new Map(
    FEATURE_DETAIL_COLUMN_OPTIONS.map((column) => [column.id, column]),
  );
  const exportColumns: BucketExportColumn[] = [
    {
      id: "name",
      label: "Name",
      getValue: (bucket) => getBucketDisplayName(bucket, useExplicitBucketName),
    },
  ];

  columnIds.forEach((columnId) => {
    const staticColumn = STATIC_BUCKET_EXPORT_COLUMNS[columnId];
    if (staticColumn) {
      exportColumns.push({ id: columnId, ...staticColumn });
      return;
    }
    if (columnId === "ui_tags") {
      exportColumns.push({
        id: columnId,
        label: "UI tags",
        getValue: (bucket) => {
          const tags = bucket.ui_tags ?? [];
          if (tags.length === 0) return "-";
          return tags
            .map((tag) =>
              isStorageOps
                ? tag.label
                : `${tag.label} (${tag.visibility === "shared" ? "Shared" : "Private"})`,
            )
            .join(", ");
        },
      });
      return;
    }
    if (columnId === "quota_status") {
      exportColumns.push({
        id: columnId,
        label: "Quota status",
        getValue: (bucket) => (isBucketQuotaConfigured(bucket) ? "Configured" : "Not set"),
      });
      return;
    }
    const detailColumn = detailColumnById.get(columnId);
    if (detailColumn) {
      exportColumns.push({
        id: columnId,
        label: detailColumn.label,
        getValue: (bucket) => formatBucketColumnDetail(bucket, detailColumn.id),
      });
      return;
    }
    const featureColumn = featureColumnById.get(columnId as FeatureKey);
    if (featureColumn) {
      exportColumns.push({
        id: columnId,
        label: featureColumn.label,
        getValue: (bucket) => bucket.features?.[featureColumn.key]?.state ?? "-",
      });
    }
  });

  return exportColumns;
}

type BucketSelectionExportInput = {
  bucketNames: readonly string[];
  bucketsByName: ReadonlyMap<string, CephAdminBucket>;
  columns: readonly BucketExportColumn[];
};

const buildBucketExportRows = ({
  bucketNames,
  bucketsByName,
  columns,
}: BucketSelectionExportInput) =>
  bucketNames.map((bucketName) => {
    const bucket = bucketsByName.get(bucketName);
    return columns.map((column) => (bucket ? column.getValue(bucket) : "-"));
  });

export function serializeBucketSelectionCsv(input: BucketSelectionExportInput): string {
  const lines = [
    input.columns.map((column) => csvEscape(column.label)).join(","),
    ...buildBucketExportRows(input).map((values) =>
      values.map((value) => csvEscape(String(value ?? "-"))).join(","),
    ),
  ];
  return lines.join("\n");
}

type BucketSelectionJsonExportInput = BucketSelectionExportInput & {
  generatedAt: string;
  scope: { id: number | null; name: string | null };
  scopeKey: "endpoint" | "scope";
};

export function buildBucketSelectionJsonPayload({
  bucketNames,
  bucketsByName,
  columns,
  generatedAt,
  scope,
  scopeKey,
}: BucketSelectionJsonExportInput) {
  return {
    generated_at: generatedAt,
    [scopeKey]: scope,
    items: buildBucketExportRows({ bucketNames, bucketsByName, columns }).map((values) =>
      Object.fromEntries(columns.map((column, index) => [column.id, values[index] ?? "-"])),
    ),
  };
}

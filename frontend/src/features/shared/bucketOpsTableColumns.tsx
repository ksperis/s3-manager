/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import PropertySummaryChip from "../../components/PropertySummaryChip";
import { formatBytes, formatNumber } from "../../utils/format";
import type { FeatureKey } from "./bucketOpsAdvancedFilterModel";
import {
  FEATURE_DETAIL_COLUMN_OPTIONS,
  type ColumnId,
} from "./bucketOpsListState";
import {
  formatBucketColumnDetail,
  formatOptionalBytes,
  formatOptionalCount,
  formatOwnerSuspended,
  formatQuotaBytes,
  formatQuotaObjects,
  formatQuotaUsageValue,
  isBucketQuotaConfigured,
} from "./bucketOpsPresentation";
import type { BucketOpsTableColumn } from "./BucketOpsTable";

type BucketOpsFeatureColumn = {
  id: FeatureKey;
  key: FeatureKey;
  label: string;
};

type BuildBucketOpsDataColumnsInput = {
  featureColumns: readonly BucketOpsFeatureColumn[];
  renderFeatureChip: (feature: FeatureKey, bucket: CephAdminBucket) => ReactNode;
  renderOwnerCell: (bucket: CephAdminBucket) => ReactNode;
  renderS3Tags: (bucket: CephAdminBucket) => ReactNode;
  renderUiTags: (bucket: CephAdminBucket) => ReactNode;
  visibleColumns: readonly ColumnId[];
};

type BucketOpsDataColumn = BucketOpsTableColumn & { id: ColumnId };

type BuildBucketOpsTableColumnsInput = BuildBucketOpsDataColumnsInput & {
  renderActions: (bucket: CephAdminBucket) => ReactNode;
  renderName: (bucket: CephAdminBucket) => ReactNode;
  renderSelection: (bucket: CephAdminBucket) => ReactNode;
  selectionHeader: ReactNode;
};

export function buildBucketOpsDataColumns({
  featureColumns,
  renderFeatureChip,
  renderOwnerCell,
  renderS3Tags,
  renderUiTags,
  visibleColumns,
}: BuildBucketOpsDataColumnsInput): BucketOpsTableColumn[] {
  const dataColumns: BucketOpsDataColumn[] = [
    {
      id: "context_name",
      label: "Context",
      field: null,
      headerClassName: "min-w-[10rem] max-w-[16rem]",
      cellClassName: "min-w-[10rem] max-w-[16rem]",
      render: (bucket) => bucket.context_name ?? "-",
    },
    {
      id: "context_kind",
      label: "Kind",
      field: null,
      headerClassName: "w-28",
      render: (bucket) => {
        if (bucket.context_kind === "account") return "Account";
        if (bucket.context_kind === "connection") return "Connection";
        if (bucket.context_kind === "s3_user") return "S3 user";
        return "-";
      },
    },
    {
      id: "endpoint_name",
      label: "Endpoint",
      field: null,
      headerClassName: "min-w-[10rem] max-w-[16rem]",
      cellClassName: "min-w-[10rem] max-w-[16rem]",
      render: (bucket) =>
        (bucket as CephAdminBucket & { endpoint_name?: string | null })
          .endpoint_name ?? "-",
    },
    {
      id: "ui_tags",
      label: "UI tags",
      field: null,
      header: <span>UI tags</span>,
      headerClassName: "min-w-[12rem] max-w-[24rem]",
      cellClassName: "min-w-[12rem] max-w-[24rem]",
      render: renderUiTags,
    },
    {
      id: "tenant",
      label: "Tenant",
      field: "tenant",
      headerClassName: "min-w-[8rem] max-w-[12rem]",
      cellClassName: "min-w-[8rem] max-w-[12rem]",
      render: (bucket) => bucket.tenant ?? "-",
    },
    {
      id: "owner",
      label: "Owner",
      field: "owner",
      headerClassName: "min-w-[14rem]",
      cellClassName: "min-w-[12rem] max-w-[24rem]",
      render: renderOwnerCell,
    },
    {
      id: "owner_name",
      label: "Owner name",
      field: null,
      expensive: true,
      headerClassName: "min-w-[12rem] max-w-[24rem]",
      cellClassName: "min-w-[12rem] max-w-[24rem]",
      render: (bucket) => bucket.owner_name ?? "-",
    },
    {
      id: "owner_suspended",
      label: "Owner suspended",
      field: null,
      expensive: true,
      headerClassName: "w-36",
      render: (bucket) => formatOwnerSuspended(bucket.owner_suspended),
    },
    {
      id: "owner_used_bytes",
      label: "Owner used",
      field: null,
      expensive: true,
      headerClassName: "w-36",
      render: (bucket) => formatOptionalBytes(bucket.owner_used_bytes),
    },
    {
      id: "owner_quota_max_size_bytes",
      label: "Owner quota",
      field: null,
      expensive: true,
      headerClassName: "w-36",
      render: (bucket) => formatQuotaBytes(bucket.owner_quota_max_size_bytes),
    },
    {
      id: "owner_quota_usage_size_percent",
      label: "Owner quota %",
      field: null,
      expensive: true,
      headerClassName: "w-32",
      render: (bucket) =>
        formatQuotaUsageValue(
          bucket.owner_used_bytes,
          bucket.owner_quota_max_size_bytes,
        ),
    },
    {
      id: "used_bytes",
      label: "Used",
      field: "used_bytes",
      headerClassName: "w-28",
      render: (bucket) => formatBytes(bucket.used_bytes),
    },
    {
      id: "quota_max_size_bytes",
      label: "Quota",
      field: null,
      headerClassName: "w-36",
      render: (bucket) => formatQuotaBytes(bucket.quota_max_size_bytes),
    },
    {
      id: "quota_usage_size_percent",
      label: "Quota %",
      field: null,
      headerClassName: "w-28",
      render: (bucket) =>
        formatQuotaUsageValue(bucket.used_bytes, bucket.quota_max_size_bytes),
    },
    {
      id: "object_count",
      label: "Objects",
      field: "object_count",
      headerClassName: "w-24",
      render: (bucket) => formatNumber(bucket.object_count),
    },
    {
      id: "quota_max_objects",
      label: "Object quota",
      field: null,
      headerClassName: "w-36",
      render: (bucket) => formatQuotaObjects(bucket.quota_max_objects),
    },
    {
      id: "quota_usage_object_percent",
      label: "Object quota %",
      field: null,
      headerClassName: "w-36",
      render: (bucket) =>
        formatQuotaUsageValue(bucket.object_count, bucket.quota_max_objects),
    },
    {
      id: "owner_object_count",
      label: "Owner objects",
      field: null,
      expensive: true,
      headerClassName: "w-36",
      render: (bucket) => formatOptionalCount(bucket.owner_object_count),
    },
    {
      id: "owner_quota_max_objects",
      label: "Owner object quota",
      field: null,
      expensive: true,
      headerClassName: "w-40",
      render: (bucket) => formatQuotaObjects(bucket.owner_quota_max_objects),
    },
    {
      id: "owner_quota_usage_object_percent",
      label: "Owner object quota %",
      field: null,
      expensive: true,
      headerClassName: "w-40",
      render: (bucket) =>
        formatQuotaUsageValue(
          bucket.owner_object_count,
          bucket.owner_quota_max_objects,
        ),
    },
    {
      id: "tags",
      label: "Tags",
      field: null,
      expensive: true,
      headerClassName: "min-w-[12rem] max-w-[24rem]",
      cellClassName: "min-w-[12rem] max-w-[24rem]",
      render: renderS3Tags,
    },
    ...featureColumns.map<BucketOpsDataColumn>((column) => ({
      id: column.id,
      label: column.label,
      field: null,
      expensive: true,
      headerClassName: "w-36",
      render: (bucket) => renderFeatureChip(column.key, bucket),
    })),
    ...FEATURE_DETAIL_COLUMN_OPTIONS.map<BucketOpsDataColumn>((detail) => ({
      id: detail.id,
      label: detail.label,
      field: null,
      expensive: true,
      headerClassName: "min-w-[10rem] max-w-[18rem]",
      cellClassName: "min-w-[10rem] max-w-[20rem]",
      render: (bucket) => {
        const value = formatBucketColumnDetail(bucket, detail.id);
        return (
          <span className="block truncate" title={value}>
            {value}
          </span>
        );
      },
    })),
    {
      id: "quota_status",
      label: "Quota status",
      field: null,
      headerClassName: "w-32",
      render: (bucket) => {
        const configured = isBucketQuotaConfigured(bucket);
        const state = configured ? "Configured" : "Not set";
        return (
          <PropertySummaryChip
            compact
            state={state}
            tone={configured ? "active" : "inactive"}
            title={`Quota: ${state}`}
          />
        );
      },
    },
  ];

  const visible = new Set(visibleColumns);
  return dataColumns.filter((column) => visible.has(column.id));
}

export function buildBucketOpsTableColumns(
  input: BuildBucketOpsTableColumnsInput,
): BucketOpsTableColumn[] {
  return [
    {
      id: "select",
      label: "",
      field: null,
      header: input.selectionHeader,
      align: "left",
      render: input.renderSelection,
    },
    {
      id: "name",
      label: "Name",
      field: "name",
      headerClassName: "w-[12rem] min-w-[10rem] max-w-[20rem]",
      cellClassName: "w-[12rem] min-w-[10rem] max-w-[20rem]",
      render: input.renderName,
    },
    ...buildBucketOpsDataColumns(input),
    {
      id: "actions",
      label: "Act.",
      field: null,
      align: "right",
      headerClassName: "w-16",
      cellClassName: "!py-1.5",
      render: input.renderActions,
    },
  ];
}

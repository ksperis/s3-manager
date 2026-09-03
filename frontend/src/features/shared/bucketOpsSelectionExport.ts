/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  CephAdminBucket,
  ListCephAdminBucketsParams,
} from "../../api/cephAdminBuckets";
import type { SelectionExportFormat } from "./bucketBulkOperationsModel";
import {
  buildBucketExportColumns,
  buildBucketSelectionJsonPayload,
  serializeBucketSelectionCsv,
  type BucketExportFeatureColumn,
} from "./bucketOpsExportModel";
import { loadBucketOpsFilteredBuckets } from "./bucketOpsFilteredBucketLoader";
import type { ColumnId } from "./bucketOpsListState";
import { loadBucketOpsBucketsByNames } from "./bucketOpsNamedBucketLoader";
import { sanitizeExportFilenamePart } from "./bucketOpsPresentation";
import { formatDownloadTimestamp } from "../../utils/download";

type BucketOpsExportPage = {
  items?: CephAdminBucket[];
  has_next: boolean;
  total?: number;
};

type BucketOpsSelectionExportInput = {
  bucketNames: readonly string[];
  exportPrefix: string;
  exportScopeKey: "endpoint" | "scope";
  exportWithStats: boolean;
  featureColumns: readonly BucketExportFeatureColumn[];
  filteredQuery: Omit<
    ListCephAdminBucketsParams,
    "include" | "page" | "page_size" | "with_stats"
  >;
  format: SelectionExportFormat;
  fullyResolvedFilteredSelection: boolean;
  include: readonly string[];
  isStorageOps: boolean;
  listBuckets: (
    scopeId: number,
    params: ListCephAdminBucketsParams,
  ) => Promise<BucketOpsExportPage>;
  now?: () => Date;
  onProgress?: (completed: number, total: number) => void;
  scopeDisplayName: string;
  scopeId: number | null;
  scopeName: string | null;
  total: number;
  useExplicitBucketName: boolean;
  visibleBuckets: readonly CephAdminBucket[];
  visibleColumns: readonly ColumnId[];
};

export type BucketOpsSelectionExportArtifact = {
  content: string;
  filename: string;
  mimeType: string;
};

async function loadSelectionBuckets({
  bucketNames,
  exportWithStats,
  filteredQuery,
  fullyResolvedFilteredSelection,
  include,
  listBuckets,
  onProgress,
  scopeId,
  total,
  visibleBuckets,
}: Pick<
  BucketOpsSelectionExportInput,
  | "bucketNames"
  | "exportWithStats"
  | "filteredQuery"
  | "fullyResolvedFilteredSelection"
  | "include"
  | "listBuckets"
  | "onProgress"
  | "scopeId"
  | "total"
  | "visibleBuckets"
>): Promise<Map<string, CephAdminBucket>> {
  if (fullyResolvedFilteredSelection) {
    if (scopeId === null || total <= 0) return new Map();
    return loadBucketOpsFilteredBuckets({
      initialTotal: total,
      listBuckets,
      onProgress,
      params: {
        ...filteredQuery,
        include: include.length > 0 ? [...include] : undefined,
        with_stats: exportWithStats,
      },
      scopeId,
    });
  }

  const selectedNames = new Set(bucketNames);
  const bucketsByName = new Map<string, CephAdminBucket>();
  visibleBuckets.forEach((bucket) => {
    if (selectedNames.has(bucket.name)) bucketsByName.set(bucket.name, bucket);
  });
  if (scopeId === null || bucketNames.length === 0) return bucketsByName;

  const loadedBuckets = await loadBucketOpsBucketsByNames({
    bucketNames,
    include: [...include],
    listBuckets,
    onProgress: ({ completed, total: progressTotal }) =>
      onProgress?.(completed, progressTotal),
    scopeId,
    withStats: exportWithStats,
  });
  loadedBuckets.forEach((bucket) => {
    if (selectedNames.has(bucket.name)) bucketsByName.set(bucket.name, bucket);
  });
  return bucketsByName;
}

export async function prepareBucketOpsSelectionExport(
  input: BucketOpsSelectionExportInput,
): Promise<BucketOpsSelectionExportArtifact> {
  const generatedAt = (input.now ?? (() => new Date()))().toISOString();
  const timestamp = formatDownloadTimestamp(generatedAt);
  const fallbackScopeName =
    input.scopeId === null
      ? input.scopeDisplayName.toLowerCase()
      : `${input.scopeDisplayName.toLowerCase()}-${input.scopeId}`;
  const scopePart = sanitizeExportFilenamePart(
    input.scopeName ?? fallbackScopeName,
  );
  const filenamePrefix = `${input.exportPrefix}-buckets-${scopePart}-${timestamp}`;

  if (input.format === "text") {
    return {
      content: input.bucketNames.join("\n"),
      filename: `${filenamePrefix}.txt`,
      mimeType: "text/plain;charset=utf-8",
    };
  }

  const bucketsByName = await loadSelectionBuckets(input);
  const columns = buildBucketExportColumns({
    columnIds: input.visibleColumns,
    featureColumns: input.featureColumns,
    isStorageOps: input.isStorageOps,
    useExplicitBucketName: input.useExplicitBucketName,
  });

  if (input.format === "csv") {
    return {
      content: serializeBucketSelectionCsv({
        bucketNames: input.bucketNames,
        bucketsByName,
        columns,
      }),
      filename: `${filenamePrefix}.csv`,
      mimeType: "text/csv;charset=utf-8",
    };
  }

  const payload = buildBucketSelectionJsonPayload({
    bucketNames: input.bucketNames,
    bucketsByName,
    columns,
    generatedAt,
    scope: { id: input.scopeId, name: input.scopeName },
    scopeKey: input.exportScopeKey,
  });
  return {
    content: JSON.stringify(payload, null, 2),
    filename: `${filenamePrefix}.json`,
    mimeType: "application/json",
  };
}

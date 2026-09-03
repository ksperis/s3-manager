/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import { decodeStorageOpsBucketRef } from "../../api/storageOps";
import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import {
  getStorageOpsBucketName,
  getStorageOpsContextId,
} from "./bucketOpsPresentation";

export type BucketOperationUiTarget = {
  bucketName: string;
  contextId?: string | null;
  contextName?: string | null;
};

export function buildStorageOpsBucketTargets(
  targets: readonly BucketOperationUiTarget[],
): Array<{ context_id: string; bucket_name: string }> {
  return targets.map((target) => {
    const contextId = target.contextId?.trim();
    if (!contextId) {
      throw new Error(`Missing context for bucket ${target.bucketName}.`);
    }
    return {
      context_id: contextId,
      bucket_name: target.bucketName,
    };
  });
}

type BucketOpsSelectionProjectionInput = {
  allFilteredBucketNames: readonly string[] | null;
  allFilteredBucketNamesKey: string | null;
  isStorageOps: boolean;
  items: readonly CephAdminBucket[];
  selectedBuckets: ReadonlySet<string>;
  selectionQueryKey: string;
  total: number;
};

export function buildBucketOpsSelectionProjection({
  allFilteredBucketNames,
  allFilteredBucketNamesKey,
  isStorageOps,
  items,
  selectedBuckets,
  selectionQueryKey,
  total,
}: BucketOpsSelectionProjectionInput) {
  const selectedBucketList = Array.from(selectedBuckets).sort((left, right) =>
    left.localeCompare(right),
  );
  const selectedBucketItemByName = new Map(items.map((bucket) => [bucket.name, bucket]));
  const selectedCount = selectedBuckets.size;
  const selectedOnPageCount = items.reduce(
    (count, bucket) => count + (selectedBuckets.has(bucket.name) ? 1 : 0),
    0,
  );
  const hasResolvedFilteredNames =
    allFilteredBucketNamesKey === selectionQueryKey &&
    Array.isArray(allFilteredBucketNames) &&
    allFilteredBucketNames.length > 0;
  const selectedOnFilteredCount = hasResolvedFilteredNames
    ? allFilteredBucketNames.reduce(
        (count, bucketName) => count + (selectedBuckets.has(bucketName) ? 1 : 0),
        0,
      )
    : selectedOnPageCount;
  const allSelectedOnFiltered =
    hasResolvedFilteredNames &&
    total > 0 &&
    allFilteredBucketNames.length === total &&
    selectedOnFilteredCount === total;
  const fullyResolvedFilteredSelection =
    allSelectedOnFiltered && selectedCount === total && allFilteredBucketNames.length === total;
  const hiddenSelectedCount = Math.max(selectedCount - selectedOnPageCount, 0);
  const allSelectedOnPage = items.length > 0 && selectedOnPageCount === items.length;
  const headerChecked = hasResolvedFilteredNames ? allSelectedOnFiltered : allSelectedOnPage;
  const headerIndeterminate = hasResolvedFilteredNames
    ? selectedOnFilteredCount > 0 && !allSelectedOnFiltered
    : selectedOnPageCount > 0 && !allSelectedOnPage;

  const selectedOperationTargets: BucketOperationUiTarget[] = isStorageOps
    ? selectedBucketList
        .map((selectedName) => {
          const bucket = selectedBucketItemByName.get(selectedName);
          if (bucket) {
            return {
              bucketName: getStorageOpsBucketName(bucket),
              contextId: getStorageOpsContextId(bucket),
              contextName: bucket.context_name ?? null,
            };
          }
          const decoded = decodeStorageOpsBucketRef(selectedName);
          return {
            bucketName: decoded?.bucketName ?? selectedName,
            contextId: decoded?.contextId ?? "",
          };
        })
        .filter((target) => target.bucketName.trim().length > 0)
    : selectedBucketList.map((bucketName) => ({ bucketName }));

  const selectedUiTagSuggestions: BucketUiTagDefinition[] = Array.from(
    new Map(
      selectedBucketList
        .flatMap((selectedName) => selectedBucketItemByName.get(selectedName)?.ui_tags ?? [])
        .map((tag) => [tag.id, tag]),
    ).values(),
  ).sort(
    (left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
      left.id - right.id,
  );

  return {
    allSelectedOnFiltered,
    fullyResolvedFilteredSelection,
    headerChecked,
    headerIndeterminate,
    hiddenSelectedCount,
    selectedBucketList,
    selectedCount,
    selectedOnFilteredCount,
    selectedOnPageCount,
    selectedOperationTargets,
    selectedUiTagSuggestions,
  };
}

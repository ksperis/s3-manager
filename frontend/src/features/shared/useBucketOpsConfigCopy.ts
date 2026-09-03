/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CephAdminBucket,
  ListCephAdminBucketsParams,
} from "../../api/cephAdminBuckets";
import type { ActionProgressState } from "./actionProgress";
import {
  loadBulkConfigClipboard,
  normalizeQuotaLimit,
  persistBulkConfigClipboard,
  type BulkConfigClipboard,
  type BulkCopyFeatureSelection,
} from "./bucketBulkOperationsModel";
import { copyBucketOpsConfigs } from "./bucketOpsConfigCopy";
import { normalizeBucketName } from "./bucketOpsPresentation";

type CopyOperationInput = Parameters<typeof copyBucketOpsConfigs>[0];
type BucketOpsConfigCopyApi = Pick<
  CopyOperationInput,
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketLogging"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
>;

type UseBucketOpsConfigCopyOptions = BucketOpsConfigCopyApi & {
  bucketNames: readonly string[];
  copyOperation?: typeof copyBucketOpsConfigs;
  extractError: (error: unknown) => string;
  features: BulkCopyFeatureSelection;
  isStorageOps: boolean;
  listBuckets: (
    scopeId: number,
    params: ListCephAdminBucketsParams,
  ) => Promise<{ items: CephAdminBucket[] }>;
  loadClipboard?: typeof loadBulkConfigClipboard;
  now?: () => Date;
  persistClipboard?: typeof persistBulkConfigClipboard;
  sourceEndpointId: number | null;
  sourceEndpointName: string | null;
  storageKey: string;
  usageFeatureEnabled: boolean;
};

type ClipboardState = {
  storageKey: string;
  value: BulkConfigClipboard | null;
};

const currentDate = () => new Date();

export function useBucketOpsConfigCopy({
  bucketNames,
  copyOperation = copyBucketOpsConfigs,
  extractError,
  features,
  getBucketCors,
  getBucketLifecycle,
  getBucketLogging,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  isStorageOps,
  listBuckets,
  loadClipboard = loadBulkConfigClipboard,
  now = currentDate,
  persistClipboard = persistBulkConfigClipboard,
  sourceEndpointId,
  sourceEndpointName,
  storageKey,
  usageFeatureEnabled,
}: UseBucketOpsConfigCopyOptions) {
  const [clipboardState, setClipboardState] = useState<ClipboardState>(() => ({
    storageKey,
    value: loadClipboard(storageKey),
  }));
  const [bulkCopyLoading, setBulkCopyLoading] = useState(false);
  const [bulkCopyProgress, setBulkCopyProgress] =
    useState<ActionProgressState | null>(null);
  const [bulkCopyError, setBulkCopyError] = useState<string | null>(null);
  const [bulkCopySummary, setBulkCopySummary] = useState<string | null>(null);
  const copyRunRef = useRef(0);

  const cancelBulkCopy = useCallback(() => {
    copyRunRef.current += 1;
    setBulkCopyLoading(false);
    setBulkCopyProgress(null);
  }, []);

  const resetBulkCopy = useCallback(() => {
    cancelBulkCopy();
    setBulkCopyError(null);
    setBulkCopySummary(null);
  }, [cancelBulkCopy]);

  useEffect(() => {
    if (clipboardState.storageKey === storageKey) return;
    resetBulkCopy();
    setClipboardState({
      storageKey,
      value: loadClipboard(storageKey),
    });
  }, [clipboardState.storageKey, loadClipboard, resetBulkCopy, storageKey]);

  useEffect(() => {
    if (clipboardState.storageKey !== storageKey) return;
    persistClipboard(storageKey, clipboardState.value);
  }, [clipboardState, persistClipboard, storageKey]);

  useEffect(() => {
    resetBulkCopy();
    return () => {
      copyRunRef.current += 1;
    };
  }, [resetBulkCopy, sourceEndpointId, sourceEndpointName]);

  const fetchBucketQuota = useCallback(
    async (bucketName: string) => {
      if (sourceEndpointId === null) {
        return { maxSizeBytes: null, maxObjects: null };
      }
      const advancedFilter = JSON.stringify({
        match: "all",
        rules: [{ field: "name", op: "in", value: [bucketName] }],
      });
      const response = await listBuckets(sourceEndpointId, {
        page: 1,
        page_size: 5,
        advanced_filter: advancedFilter,
        with_stats: usageFeatureEnabled,
      });
      const match =
        response.items.find(
          (item) =>
            normalizeBucketName(item.name) === normalizeBucketName(bucketName),
        ) ??
        response.items[0] ??
        null;
      return {
        maxSizeBytes: normalizeQuotaLimit(match?.quota_max_size_bytes),
        maxObjects: normalizeQuotaLimit(match?.quota_max_objects),
      };
    },
    [listBuckets, sourceEndpointId, usageFeatureEnabled],
  );

  const copyBulkConfigs = useCallback(async () => {
    if (sourceEndpointId === null || bucketNames.length === 0) return;
    const runToken = copyRunRef.current + 1;
    copyRunRef.current = runToken;
    setBulkCopyLoading(true);
    setBulkCopyError(null);
    setBulkCopySummary(null);
    setBulkCopyProgress({
      label: "Copying selected configs",
      completed: 0,
      total: bucketNames.length,
      failed: 0,
    });
    try {
      const result = await copyOperation({
        bucketNames,
        copiedAt: now().toISOString(),
        features,
        fetchBucketQuota,
        getBucketCors,
        getBucketLifecycle,
        getBucketLogging,
        getBucketPolicy,
        getBucketProperties,
        getBucketPublicAccessBlock,
        isStorageOps,
        onProgress: (progress) => {
          if (copyRunRef.current === runToken) {
            setBulkCopyProgress({
              label: "Copying selected configs",
              ...progress,
            });
          }
        },
        sourceEndpointId,
        sourceEndpointName,
      });
      if (copyRunRef.current !== runToken) return;
      if (result.kind === "error") {
        setBulkCopyError(result.error);
        return;
      }
      setClipboardState({ storageKey, value: result.clipboard });
      setBulkCopySummary(result.summary);
    } catch (error) {
      if (copyRunRef.current === runToken) {
        setBulkCopyError(extractError(error));
      }
    } finally {
      if (copyRunRef.current === runToken) {
        setBulkCopyLoading(false);
        setBulkCopyProgress(null);
      }
    }
  }, [
    bucketNames,
    copyOperation,
    extractError,
    features,
    fetchBucketQuota,
    getBucketCors,
    getBucketLifecycle,
    getBucketLogging,
    getBucketPolicy,
    getBucketProperties,
    getBucketPublicAccessBlock,
    isStorageOps,
    now,
    sourceEndpointId,
    sourceEndpointName,
    storageKey,
  ]);

  return {
    bulkConfigClipboard:
      clipboardState.storageKey === storageKey ? clipboardState.value : null,
    bulkCopyError,
    bulkCopyLoading,
    bulkCopyProgress,
    bulkCopySummary,
    cancelBulkCopy,
    copyBulkConfigs,
    fetchBucketQuota,
    resetBulkCopy,
  };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionProgressState } from "./actionProgress";
import type {
  BulkConfigClipboard,
  BulkOperation,
  BulkPastePlan,
  BulkPreviewItem,
} from "./bucketBulkOperationsModel";
import type { PreparedBucketOpsBulkInput } from "./bucketOpsBulkInput";
import { previewBucketOpsBulkUpdate } from "./bucketOpsBulkPreview";
import { previewBucketOpsConfigPaste } from "./bucketOpsConfigPastePreview";

type BulkPreviewInput = Parameters<typeof previewBucketOpsBulkUpdate>[0];
type PastePreviewInput = Parameters<typeof previewBucketOpsConfigPaste>[0];
type BulkPreviewApi = Pick<
  BulkPreviewInput,
  | "fetchBucketQuota"
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketNotifications"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
> &
  Pick<PastePreviewInput, "getBucketLogging">;

type UseBucketOpsBulkPreviewOptions = BulkPreviewApi & {
  bucketNames: readonly string[];
  clipboard: BulkConfigClipboard | null;
  corsUpdateOnlyExisting: boolean;
  endpointId: number | null;
  extractError: (error: unknown) => string;
  isStorageOps: boolean;
  lifecycleUpdateOnlyExisting: boolean;
  onPreviewStart: () => void;
  operation: BulkOperation;
  pastePlan: BulkPastePlan;
  policyUpdateOnlyExisting: boolean;
  prepared: { kind: "success"; value: PreparedBucketOpsBulkInput } | { kind: "error"; error: string };
  previewBulkOperation?: typeof previewBucketOpsBulkUpdate;
  previewPasteOperation?: typeof previewBucketOpsConfigPaste;
  quotaDisabledReason: string | null;
  quotaSkipConfigured: boolean;
};

export function useBucketOpsBulkPreview({
  bucketNames,
  clipboard,
  corsUpdateOnlyExisting,
  endpointId,
  extractError,
  fetchBucketQuota,
  getBucketCors,
  getBucketLifecycle,
  getBucketLogging,
  getBucketNotifications,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  isStorageOps,
  lifecycleUpdateOnlyExisting,
  onPreviewStart,
  operation,
  pastePlan,
  policyUpdateOnlyExisting,
  prepared,
  previewBulkOperation = previewBucketOpsBulkUpdate,
  previewPasteOperation = previewBucketOpsConfigPaste,
  quotaDisabledReason,
  quotaSkipConfigured,
}: UseBucketOpsBulkPreviewOptions) {
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewItem[]>([]);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkPreviewProgress, setBulkPreviewProgress] =
    useState<ActionProgressState | null>(null);
  const [bulkPreviewError, setBulkPreviewError] = useState<string | null>(null);
  const [bulkPreviewReady, setBulkPreviewReady] = useState(false);
  const previewRunRef = useRef(0);

  const resetBulkPreview = useCallback(() => {
    previewRunRef.current += 1;
    setBulkPreviewLoading(false);
    setBulkPreview([]);
    setBulkPreviewError(null);
    setBulkPreviewReady(false);
    setBulkPreviewProgress(null);
  }, []);

  useEffect(() => {
    resetBulkPreview();
    return () => {
      previewRunRef.current += 1;
    };
  }, [endpointId, resetBulkPreview]);

  const runBulkPreview = useCallback(async () => {
    if (endpointId === null || bucketNames.length === 0) return;
    if (!operation) {
      setBulkPreviewError("Select an operation first.");
      return;
    }
    if (operation === "copy_configs") {
      setBulkPreviewError("Use 'Copy selected configs' for this operation.");
      return;
    }
    if (operation === "set_quota" && quotaDisabledReason) {
      setBulkPreviewError(
        `Set bucket quota is unavailable: ${quotaDisabledReason}.`,
      );
      return;
    }
    if (operation === "paste_configs" && pastePlan.error) {
      setBulkPreviewError(pastePlan.error);
      return;
    }
    if (operation !== "paste_configs" && prepared.kind === "error") {
      setBulkPreviewError(prepared.error);
      return;
    }

    const total =
      operation === "paste_configs" ? pastePlan.mappings.length : bucketNames.length;
    const runToken = previewRunRef.current + 1;
    previewRunRef.current = runToken;
    setBulkPreviewLoading(true);
    setBulkPreviewError(null);
    setBulkPreview([]);
    setBulkPreviewReady(false);
    setBulkPreviewProgress({
      label: "Previewing changes",
      completed: 0,
      total,
      failed: 0,
    });
    onPreviewStart();

    const updateProgress = (progress: {
      completed: number;
      total: number;
      failed: number;
    }) => {
      if (previewRunRef.current === runToken) {
        setBulkPreviewProgress({ label: "Previewing changes", ...progress });
      }
    };

    try {
      let previewItems: BulkPreviewItem[];
      if (operation === "paste_configs") {
        previewItems = await previewPasteOperation({
          clipboard,
          fetchBucketQuota,
          getBucketCors,
          getBucketLifecycle,
          getBucketLogging,
          getBucketPolicy,
          getBucketProperties,
          getBucketPublicAccessBlock,
          isStorageOps,
          mappings: pastePlan.mappings,
          onProgress: updateProgress,
          targetEndpointId: endpointId,
        });
      } else {
        if (prepared.kind !== "success") return;
        previewItems = await previewBulkOperation({
          bucketNames,
          corsUpdateOnlyExisting,
          endpointId,
          fetchBucketQuota,
          getBucketCors,
          getBucketLifecycle,
          getBucketNotifications,
          getBucketPolicy,
          getBucketProperties,
          getBucketPublicAccessBlock,
          lifecycleUpdateOnlyExisting,
          onProgress: updateProgress,
          operation,
          policyUpdateOnlyExisting,
          prepared: prepared.value,
          quotaSkipConfigured,
        });
      }
      if (previewRunRef.current !== runToken) return;
      setBulkPreview(previewItems);
      setBulkPreviewReady(true);
    } catch (error) {
      if (previewRunRef.current === runToken) {
        setBulkPreviewError(extractError(error));
      }
    } finally {
      if (previewRunRef.current === runToken) {
        setBulkPreviewLoading(false);
        setBulkPreviewProgress(null);
      }
    }
  }, [
    bucketNames,
    clipboard,
    corsUpdateOnlyExisting,
    endpointId,
    extractError,
    fetchBucketQuota,
    getBucketCors,
    getBucketLifecycle,
    getBucketLogging,
    getBucketNotifications,
    getBucketPolicy,
    getBucketProperties,
    getBucketPublicAccessBlock,
    isStorageOps,
    lifecycleUpdateOnlyExisting,
    onPreviewStart,
    operation,
    pastePlan,
    policyUpdateOnlyExisting,
    prepared,
    previewBulkOperation,
    previewPasteOperation,
    quotaDisabledReason,
    quotaSkipConfigured,
  ]);

  return {
    bulkPreview,
    bulkPreviewError,
    bulkPreviewLoading,
    bulkPreviewProgress,
    bulkPreviewReady,
    resetBulkPreview,
    runBulkPreview,
  };
}

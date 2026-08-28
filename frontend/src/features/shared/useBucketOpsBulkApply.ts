/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionProgressState } from "./actionProgress";
import { applyBucketOpsBulkUpdate } from "./bucketOpsBulkApply";
import type {
  BulkConfigClipboard,
  BulkOperation,
  BulkPastePlan,
} from "./bucketBulkOperationsModel";
import type { PreparedBucketOpsBulkInput } from "./bucketOpsBulkInput";
import { applyBucketOpsConfigPaste } from "./bucketOpsConfigPaste";

type BulkApplyInput = Parameters<typeof applyBucketOpsBulkUpdate>[0];
type PasteApplyInput = Parameters<typeof applyBucketOpsConfigPaste>[0];
type BulkApplyApi = Pick<
  BulkApplyInput,
  | "deleteBucketCors"
  | "deleteBucketLifecycle"
  | "deleteBucketNotifications"
  | "deleteBucketPolicy"
  | "fetchBucketQuota"
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketNotifications"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
  | "putBucketCors"
  | "putBucketLifecycle"
  | "putBucketNotifications"
  | "putBucketPolicy"
  | "setBucketVersioning"
  | "updateBucketPublicAccessBlock"
  | "updateBucketQuota"
> &
  Pick<
    PasteApplyInput,
    | "deleteBucketLogging"
    | "getBucketLogging"
    | "putBucketLogging"
    | "updateBucketObjectLock"
  >;

type UseBucketOpsBulkApplyOptions = BulkApplyApi & {
  applyBulkOperation?: typeof applyBucketOpsBulkUpdate;
  applyPasteOperation?: typeof applyBucketOpsConfigPaste;
  bucketNames: readonly string[];
  clipboard: BulkConfigClipboard | null;
  corsUpdateOnlyExisting: boolean;
  endpointId: number | null;
  extractError: (error: unknown) => string;
  isStorageOps: boolean;
  lifecycleUpdateOnlyExisting: boolean;
  operation: BulkOperation;
  pastePlan: BulkPastePlan;
  policyUpdateOnlyExisting: boolean;
  prepared:
    | { kind: "success"; value: PreparedBucketOpsBulkInput }
    | { kind: "error"; error: string };
  quotaDisabledReason: string | null;
  quotaSkipConfigured: boolean;
  refreshBuckets: () => void;
};

export function useBucketOpsBulkApply({
  applyBulkOperation = applyBucketOpsBulkUpdate,
  applyPasteOperation = applyBucketOpsConfigPaste,
  bucketNames,
  clipboard,
  corsUpdateOnlyExisting,
  deleteBucketCors,
  deleteBucketLifecycle,
  deleteBucketLogging,
  deleteBucketNotifications,
  deleteBucketPolicy,
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
  operation,
  pastePlan,
  policyUpdateOnlyExisting,
  prepared,
  putBucketCors,
  putBucketLifecycle,
  putBucketLogging,
  putBucketNotifications,
  putBucketPolicy,
  quotaDisabledReason,
  quotaSkipConfigured,
  refreshBuckets,
  setBucketVersioning,
  updateBucketObjectLock,
  updateBucketPublicAccessBlock,
  updateBucketQuota,
}: UseBucketOpsBulkApplyOptions) {
  const [bulkApplyLoading, setBulkApplyLoading] = useState(false);
  const [bulkApplyError, setBulkApplyError] = useState<string | null>(null);
  const [bulkApplySummary, setBulkApplySummary] = useState<string | null>(null);
  const [bulkApplyProgress, setBulkApplyProgress] =
    useState<ActionProgressState | null>(null);
  const generationRef = useRef(0);
  const activeRunRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const resetBulkApply = useCallback(() => {
    generationRef.current += 1;
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress(null);
    if (activeRunRef.current === null) {
      setBulkApplyLoading(false);
    }
  }, []);

  useEffect(() => {
    resetBulkApply();
  }, [endpointId, resetBulkApply]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const applyBulkUpdate = useCallback(async () => {
    if (
      endpointId === null ||
      bucketNames.length === 0 ||
      activeRunRef.current !== null
    ) {
      return;
    }
    if (!operation) {
      setBulkApplyError("Select an operation first.");
      return;
    }
    if (operation === "copy_configs") {
      setBulkApplyError("Use 'Copy selected configs' for this operation.");
      return;
    }
    if (operation === "set_quota" && quotaDisabledReason) {
      setBulkApplyError(
        `Set bucket quota is unavailable: ${quotaDisabledReason}.`,
      );
      return;
    }
    if (operation === "paste_configs" && pastePlan.error) {
      setBulkApplyError(pastePlan.error);
      return;
    }
    if (operation !== "paste_configs" && prepared.kind === "error") {
      setBulkApplyError(prepared.error);
      return;
    }

    const total =
      operation === "paste_configs" ? pastePlan.mappings.length : bucketNames.length;
    const runToken = generationRef.current + 1;
    generationRef.current = runToken;
    activeRunRef.current = runToken;
    setBulkApplyLoading(true);
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress({
      label: "Applying changes",
      completed: 0,
      total,
      failed: 0,
    });

    const updateProgress = (progress: {
      completed: number;
      total: number;
      failed: number;
    }) => {
      if (generationRef.current === runToken && mountedRef.current) {
        setBulkApplyProgress({ label: "Applying changes", ...progress });
      }
    };

    try {
      let result: Awaited<ReturnType<typeof applyBucketOpsBulkUpdate>>;
      if (operation === "paste_configs") {
        result = await applyPasteOperation({
          clipboard,
          deleteBucketCors,
          deleteBucketLifecycle,
          deleteBucketLogging,
          deleteBucketPolicy,
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
          putBucketCors,
          putBucketLifecycle,
          putBucketLogging,
          putBucketPolicy,
          setBucketVersioning,
          targetEndpointId: endpointId,
          updateBucketObjectLock,
          updateBucketPublicAccessBlock,
          updateBucketQuota,
        });
      } else {
        if (prepared.kind !== "success") return;
        result = await applyBulkOperation({
          bucketNames,
          corsUpdateOnlyExisting,
          deleteBucketCors,
          deleteBucketLifecycle,
          deleteBucketNotifications,
          deleteBucketPolicy,
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
          putBucketCors,
          putBucketLifecycle,
          putBucketNotifications,
          putBucketPolicy,
          quotaSkipConfigured,
          setBucketVersioning,
          updateBucketPublicAccessBlock,
          updateBucketQuota,
        });
      }
      if (generationRef.current !== runToken || !mountedRef.current) return;
      setBulkApplyError(result.error);
      setBulkApplySummary(result.summary);
    } catch (error) {
      if (generationRef.current === runToken && mountedRef.current) {
        setBulkApplyError(extractError(error));
      }
    } finally {
      if (activeRunRef.current === runToken) {
        activeRunRef.current = null;
        if (mountedRef.current) {
          setBulkApplyLoading(false);
          if (generationRef.current === runToken) {
            setBulkApplyProgress(null);
            refreshBuckets();
          }
        }
      }
    }
  }, [
    applyBulkOperation,
    applyPasteOperation,
    bucketNames,
    clipboard,
    corsUpdateOnlyExisting,
    deleteBucketCors,
    deleteBucketLifecycle,
    deleteBucketLogging,
    deleteBucketNotifications,
    deleteBucketPolicy,
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
    operation,
    pastePlan,
    policyUpdateOnlyExisting,
    prepared,
    putBucketCors,
    putBucketLifecycle,
    putBucketLogging,
    putBucketNotifications,
    putBucketPolicy,
    quotaDisabledReason,
    quotaSkipConfigured,
    refreshBuckets,
    setBucketVersioning,
    updateBucketObjectLock,
    updateBucketPublicAccessBlock,
    updateBucketQuota,
  ]);

  return {
    applyBulkUpdate,
    bulkApplyError,
    bulkApplyLoading,
    bulkApplyProgress,
    bulkApplySummary,
    resetBulkApply,
  };
}

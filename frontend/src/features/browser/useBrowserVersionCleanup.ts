/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import { cleanupObjectVersions } from "../../api/browserObjects";
import type { OperationCompletionStatus } from "./browserTypes";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

export type BrowserVersionCleanupDraft = {
  deleteOrphanMarkers: boolean;
  keepLast: string;
  olderThanDays: string;
};

type UseBrowserVersionCleanupOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  currentPath: string;
  enabled: boolean;
  isOperationAborted: OperationRegistry["isOperationAborted"];
  normalizedPrefix: string;
  onRefresh: (prefix: string) => void;
  onRefreshNow: (prefix: string) => Promise<void>;
  onStatus: (message: string) => void;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
  showOperations: () => void;
  startOperation: OperationRegistry["startOperation"];
  versioningEnabled: boolean;
};

export function createBrowserVersionCleanupDraft(): BrowserVersionCleanupDraft {
  return {
    deleteOrphanMarkers: false,
    keepLast: "",
    olderThanDays: "",
  };
}

export function useBrowserVersionCleanup({
  accountId,
  bucketName,
  clearOperationController,
  completeOperation,
  createOperationController,
  currentPath,
  enabled,
  isOperationAborted,
  normalizedPrefix,
  onRefresh,
  onRefreshNow,
  onStatus,
  prefix,
  requestOptions,
  showOperations,
  startOperation,
  versioningEnabled,
}: UseBrowserVersionCleanupOptions) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(createBrowserVersionCleanupDraft);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const show = useCallback(() => {
    if (!versioningEnabled) return;
    setError(null);
    setSummary(null);
    setOpen(true);
  }, [versioningEnabled]);

  const close = useCallback(() => setOpen(false), []);

  const apply = useCallback(async () => {
    if (!bucketName || !enabled) return;
    const parsedKeepLast = Number.parseInt(draft.keepLast, 10);
    const parsedOlderThanDays = Number.parseInt(draft.olderThanDays, 10);
    const keepLast = Number.isNaN(parsedKeepLast)
      ? undefined
      : parsedKeepLast;
    const olderThanDays = Number.isNaN(parsedOlderThanDays)
      ? undefined
      : parsedOlderThanDays;
    if (!keepLast && !olderThanDays && !draft.deleteOrphanMarkers) {
      setError("Select at least one cleanup rule.");
      return;
    }
    if (keepLast !== undefined && keepLast < 1) {
      setError("Keep last versions must be at least 1.");
      return;
    }
    if (olderThanDays !== undefined && olderThanDays < 1) {
      setError("Older than days must be at least 1.");
      return;
    }

    setLoading(true);
    setError(null);
    setSummary(null);
    showOperations();
    const operationId = startOperation(
      "deleting",
      "Cleaning old versions",
      currentPath || bucketName,
      { kind: "other", cancelable: true },
      0,
    );
    const controller = createOperationController(operationId);
    let completionStatus: OperationCompletionStatus = "done";
    let completionError: string | undefined;
    try {
      const result = await cleanupObjectVersions(
        accountId,
        bucketName,
        {
          prefix: normalizedPrefix,
          keep_last_n: keepLast,
          older_than_days: olderThanDays,
          delete_orphan_markers: draft.deleteOrphanMarkers,
        },
        controller.signal,
        requestOptions,
      );
      const nextSummary = `Removed ${result.deleted_versions} version(s) and ${result.deleted_delete_markers} delete marker(s).`;
      setSummary(nextSummary);
      onStatus(nextSummary);
      onRefresh(prefix);
    } catch (caughtError) {
      if (isOperationAborted(caughtError, controller)) {
        completionStatus = "cancelled";
        setSummary("Cleanup cancelled.");
        onStatus("Cleanup cancelled.");
        await onRefreshNow(prefix);
      } else {
        completionStatus = "failed";
        completionError = "Unable to clean old versions for this prefix.";
        setError(completionError);
      }
    } finally {
      clearOperationController(operationId);
      completeOperation(operationId, completionStatus, completionError);
      setLoading(false);
    }
  }, [
    accountId,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    draft,
    enabled,
    isOperationAborted,
    normalizedPrefix,
    onRefresh,
    onRefreshNow,
    onStatus,
    prefix,
    requestOptions,
    showOperations,
    startOperation,
  ]);

  return {
    apply,
    close,
    draft,
    error,
    loading,
    open,
    setDraft,
    show,
    summary,
  };
}

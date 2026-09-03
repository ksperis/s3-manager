/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  copyObject,
  listObjectVersions,
} from "../../api/browserObjects";
import type { BrowserObjectVersion } from "../../api/browserContracts";
import { runWithConcurrency } from "../../utils/concurrency";
import { buildBulkRestorePlan } from "./browserBulkRestorePlan";
import type { BrowserItem } from "./browserTypes";
import { formatLocalDateTime, makeId } from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

export type BrowserBulkRestoreDraft = {
  date: string;
  deleteMissing: boolean;
  dryRun: boolean;
  restoreDeleted: boolean;
};

export type BrowserBulkRestorePreview = {
  restoreKeys: string[];
  deleteKeys: string[];
  unchangedKeys: string[];
  totalRestore: number;
  totalDelete: number;
  totalUnchanged: number;
};

type DeleteObjectsInBatches = (
  keys: string[],
  onProgress?: (deleted: number, total: number) => void,
  detailOperationId?: string,
  signal?: AbortSignal,
) => Promise<number>;

type UseBrowserBulkRestoreOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  currentPath: string;
  deleteObjectsInBatches: DeleteObjectsInBatches;
  enabled: boolean;
  isOperationAborted: OperationRegistry["isOperationAborted"];
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  normalizedPrefix: string;
  onRefresh: (prefix: string) => void;
  onRefreshNow: (prefix: string) => Promise<void>;
  onStatus: (message: string) => void;
  parallelism: number;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
  showOperations: () => void;
  startOperation: OperationRegistry["startOperation"];
  updateOperation: OperationRegistry["updateOperation"];
  versioningEnabled: boolean;
};

export function createBrowserBulkRestoreDraft(): BrowserBulkRestoreDraft {
  return {
    date: formatLocalDateTime(new Date()),
    deleteMissing: false,
    dryRun: false,
    restoreDeleted: false,
  };
}

export function useBrowserBulkRestore({
  accountId,
  bucketName,
  clearOperationController,
  completeOperation,
  createOperationController,
  currentPath,
  deleteObjectsInBatches,
  enabled,
  isOperationAborted,
  listAllObjectsForPrefix,
  normalizedPrefix,
  onRefresh,
  onRefreshNow,
  onStatus,
  parallelism,
  prefix,
  requestOptions,
  showOperations,
  startOperation,
  updateOperation,
  versioningEnabled,
}: UseBrowserBulkRestoreOptions) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<BrowserItem[]>([]);
  const [draft, setDraft] = useState(createBrowserBulkRestoreDraft);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [preview, setPreview] = useState<BrowserBulkRestorePreview | null>(null);
  const [targetPath, setTargetPath] = useState<string | null>(null);

  const fileCount = useMemo(
    () => targets.filter((item) => item.type === "file").length,
    [targets],
  );
  const folderCount = useMemo(
    () => targets.filter((item) => item.type === "folder").length,
    [targets],
  );

  const reset = useCallback(() => {
    setDraft(createBrowserBulkRestoreDraft());
    setError(null);
    setSummary(null);
    setPreview(null);
    setTargetPath(null);
  }, []);

  const show = useCallback(
    (items: BrowserItem[]) => {
      if (!versioningEnabled) return;
      const pathTarget: BrowserItem | null = bucketName
        ? {
            id: makeId(),
            key: normalizedPrefix,
            name: normalizedPrefix
              ? normalizedPrefix.replace(/\/$/, "")
              : bucketName,
            type: "folder",
            size: "",
            modified: "",
            owner: "",
            sizeBytes: null,
            modifiedAt: null,
            storageClass: undefined,
          }
        : null;
      const resolvedTargets =
        items.length > 0 ? items : pathTarget ? [pathTarget] : [];
      if (resolvedTargets.length === 0) return;
      setTargets(resolvedTargets);
      reset();
      if (items.length === 0 && pathTarget) {
        setTargetPath(currentPath || bucketName);
      }
      setOpen(true);
    },
    [bucketName, currentPath, normalizedPrefix, reset, versioningEnabled],
  );

  const close = useCallback(() => setOpen(false), []);

  const listAllVersions = useCallback(
    async (selector: { key?: string; prefix?: string }) => {
      if (!bucketName || !enabled || !versioningEnabled) {
        return { versions: [], deleteMarkers: [] };
      }
      const versions: BrowserObjectVersion[] = [];
      const deleteMarkers: BrowserObjectVersion[] = [];
      let keyMarker: string | null = null;
      let versionIdMarker: string | null = null;
      let hasMore = true;
      while (hasMore) {
        const data = await listObjectVersions(accountId, bucketName, {
          ...selector,
          keyMarker,
          versionIdMarker,
          maxKeys: 1000,
          requestOptions,
        });
        versions.push(...data.versions);
        deleteMarkers.push(...data.delete_markers);
        keyMarker = data.next_key_marker ?? null;
        versionIdMarker = data.next_version_id_marker ?? null;
        hasMore = Boolean(data.is_truncated && keyMarker);
      }
      return { versions, deleteMarkers };
    },
    [accountId, bucketName, enabled, requestOptions, versioningEnabled],
  );

  const apply = useCallback(async () => {
    if (!bucketName || !enabled) return;
    if (!versioningEnabled) {
      setError("Versioning is not enabled for this bucket.");
      return;
    }
    const isLatestRestoreMode = draft.restoreDeleted;
    const allowDeleteMissing = !isLatestRestoreMode && draft.deleteMissing;
    const targetTime = draft.date ? new Date(draft.date).getTime() : Number.NaN;
    if (!isLatestRestoreMode && (!draft.date || Number.isNaN(targetTime))) {
      setError("Select a valid date.");
      return;
    }
    setLoading(true);
    setError(null);
    setSummary(null);
    setPreview(null);
    let operationId: string | null = null;
    let controller: AbortController | null = null;
    try {
      const { restoreList, deleteList, unchangedKeys } =
        await buildBulkRestorePlan({
          items: targets,
          restoreLatestDeleted: isLatestRestoreMode,
          targetTime,
          deleteMissing: allowDeleteMissing,
          listVersionsForKey: (key) => listAllVersions({ key }),
          listVersionsForPrefix: (targetPrefix) =>
            listAllVersions({ prefix: targetPrefix }),
          listObjectsForPrefix: listAllObjectsForPrefix,
        });
      const unchangedCount = unchangedKeys.size;
      const total = restoreList.length + deleteList.length;
      if (total === 0) {
        if (unchangedCount > 0) {
          const nextSummary = draft.dryRun
            ? `Dry run: unchanged ${unchangedCount} object(s).`
            : `Unchanged ${unchangedCount} object(s).`;
          setSummary(nextSummary);
          onStatus(nextSummary);
          if (draft.dryRun) {
            setPreview({
              restoreKeys: [],
              deleteKeys: [],
              unchangedKeys: Array.from(unchangedKeys).slice(0, 20),
              totalRestore: 0,
              totalDelete: 0,
              totalUnchanged: unchangedCount,
            });
          }
        } else {
          setError(
            isLatestRestoreMode
              ? "No deleted objects can be restored to their latest version."
              : "No objects matched the selected date.",
          );
        }
        return;
      }

      if (draft.dryRun) {
        setSummary(
          `Dry run: would restore ${restoreList.length} object(s), delete ${deleteList.length} object(s), unchanged ${unchangedCount} object(s).`,
        );
        setPreview({
          restoreKeys: restoreList.slice(0, 20).map((item) => item.key),
          deleteKeys: deleteList.slice(0, 20),
          unchangedKeys: Array.from(unchangedKeys).slice(0, 20),
          totalRestore: restoreList.length,
          totalDelete: deleteList.length,
          totalUnchanged: unchangedCount,
        });
        return;
      }

      if (total > 1) showOperations();
      operationId = startOperation(
        "copying",
        "Restoring snapshot",
        currentPath || bucketName,
        { kind: "other", cancelable: true },
        0,
      );
      controller = createOperationController(operationId);
      let completed = 0;
      let restoredCount = 0;
      let deletedCount = 0;
      let restoreFailures = 0;
      let deleteFailures = 0;
      let cancelled = false;

      const updateProgress = (count: number) => {
        const progress = total > 0 ? Math.round((count / total) * 100) : 100;
        updateOperation(operationId, { progress });
      };

      if (restoreList.length > 0) {
        await runWithConcurrency(
          restoreList,
          parallelism,
          async (item) => {
            if (controller?.signal.aborted) {
              cancelled = true;
              return;
            }
            try {
              await copyObject(
                accountId,
                bucketName,
                {
                  source_key: item.key,
                  source_version_id: item.versionId,
                  destination_key: item.key,
                  replace_metadata: false,
                  move: false,
                },
                controller?.signal,
                requestOptions,
              );
              restoredCount += 1;
            } catch {
              if (controller?.signal.aborted) {
                cancelled = true;
                return;
              }
              restoreFailures += 1;
            } finally {
              completed += 1;
              updateProgress(completed);
            }
          },
          () => cancelled,
        );
      }

      if (!cancelled && deleteList.length > 0) {
        try {
          deletedCount = await deleteObjectsInBatches(
            deleteList,
            (deleted) => updateProgress(completed + deleted),
            undefined,
            controller?.signal,
          );
        } catch (caughtError) {
          if (isOperationAborted(caughtError, controller)) {
            cancelled = true;
          } else {
            deleteFailures = deleteList.length;
          }
        }
      }

      if (cancelled || controller.signal.aborted) {
        const nextSummary = `Restore cancelled after ${restoredCount + deletedCount} of ${total} item(s).`;
        completeOperation(operationId, "cancelled");
        setSummary(nextSummary);
        onStatus(nextSummary);
        await onRefreshNow(prefix);
        return;
      }

      const failures = restoreFailures + deleteFailures;
      completeOperation(
        operationId,
        failures > 0 ? "failed" : "done",
        failures > 0
          ? "Some objects failed to restore or delete."
          : undefined,
      );
      const nextSummary = `Restored ${restoreList.length - restoreFailures} object(s), deleted ${deleteList.length - deleteFailures} object(s), unchanged ${unchangedCount} object(s).`;
      setSummary(nextSummary);
      onStatus(nextSummary);
      onRefresh(prefix);
    } catch {
      setError("Unable to restore objects.");
    } finally {
      if (operationId) clearOperationController(operationId);
      setLoading(false);
    }
  }, [
    accountId,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    deleteObjectsInBatches,
    draft,
    enabled,
    isOperationAborted,
    listAllObjectsForPrefix,
    listAllVersions,
    onRefresh,
    onRefreshNow,
    onStatus,
    parallelism,
    prefix,
    requestOptions,
    showOperations,
    startOperation,
    targets,
    updateOperation,
    versioningEnabled,
  ]);

  return {
    apply,
    close,
    draft,
    error,
    fileCount,
    folderCount,
    loading,
    open,
    preview,
    setDraft,
    show,
    summary,
    targetPath,
  };
}

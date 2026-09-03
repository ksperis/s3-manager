/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import { deleteObjects } from "../../api/browserObjects";
import { runWithConcurrency } from "../../utils/concurrency";
import { formatBrowserOperationError } from "./browserOperationErrors";
import { updateOperationDetailsByKey } from "./browserOperationDetailState";
import type {
  BrowserItem,
  DeleteDetailStatus,
  OperationCompletionStatus,
} from "./browserTypes";
import {
  chunkItems,
  isAbortError,
  makeId,
  normalizePrefix,
} from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

type DeleteConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: "danger";
  onConfirm: () => Promise<void> | void;
};

type UseBrowserDeleteItemsOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  cancelDeleteDetails: OperationRegistry["cancelDeleteDetails"];
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  currentPath: string;
  enabled: boolean;
  isOperationAborted: OperationRegistry["isOperationAborted"];
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  onConfirm: (confirmation: DeleteConfirmation) => void;
  onProcessed: (items: BrowserItem[]) => void;
  onRefresh: (prefix: string) => Promise<void>;
  onRefreshNow: (prefix: string) => Promise<void>;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  parallelism: number;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
  setDeleteDetails: OperationRegistry["setDeleteDetails"];
  showOperations: () => void;
  startOperation: OperationRegistry["startOperation"];
  updateOperation: OperationRegistry["updateOperation"];
};

export function useBrowserDeleteItems({
  accountId,
  bucketName,
  cancelDeleteDetails,
  clearOperationController,
  completeOperation,
  createOperationController,
  currentPath,
  enabled,
  isOperationAborted,
  listAllObjectsForPrefix,
  onConfirm,
  onProcessed,
  onRefresh,
  onRefreshNow,
  onStatus,
  onWarning,
  parallelism,
  prefix,
  requestOptions,
  setDeleteDetails,
  showOperations,
  startOperation,
  updateOperation,
}: UseBrowserDeleteItemsOptions) {
  const updateDeleteDetailsStatus = useCallback(
    (
      operationId: string,
      keys: string[],
      status: DeleteDetailStatus,
      errorMessage?: string,
    ) => {
      setDeleteDetails((previous) =>
        updateOperationDetailsByKey(
          previous,
          operationId,
          keys,
          status,
          errorMessage,
        ),
      );
    },
    [setDeleteDetails],
  );

  const deleteObjectsInBatches = useCallback(
    async (
      keys: string[],
      onProgress?: (deleted: number, total: number) => void,
      detailOperationId?: string,
      signal?: AbortSignal,
    ) => {
      if (!bucketName || !enabled || keys.length === 0) return 0;
      const uniqueKeys = Array.from(new Set(keys));
      const total = uniqueKeys.length;
      const chunks = chunkItems(uniqueKeys, 1000);
      let deletedCount = 0;
      let failure: unknown = null;
      await runWithConcurrency(
        chunks,
        parallelism,
        async (chunk) => {
          if (signal?.aborted) {
            failure = new DOMException("Aborted", "AbortError");
            return;
          }
          try {
            if (detailOperationId) {
              updateDeleteDetailsStatus(
                detailOperationId,
                chunk,
                "deleting",
              );
            }
            await deleteObjects(
              accountId,
              bucketName,
              chunk.map((key) => ({ key })),
              signal,
              requestOptions,
            );
            if (signal?.aborted) {
              if (detailOperationId) {
                updateDeleteDetailsStatus(
                  detailOperationId,
                  chunk,
                  "cancelled",
                );
              }
              failure = new DOMException("Aborted", "AbortError");
              return;
            }
            if (detailOperationId) {
              updateDeleteDetailsStatus(detailOperationId, chunk, "done");
            }
            deletedCount += chunk.length;
            onProgress?.(deletedCount, total);
          } catch (caughtError) {
            if (isAbortError(caughtError) || signal?.aborted) {
              if (detailOperationId) {
                updateDeleteDetailsStatus(
                  detailOperationId,
                  chunk,
                  "cancelled",
                );
              }
              failure = caughtError;
              return;
            }
            if (detailOperationId) {
              updateDeleteDetailsStatus(
                detailOperationId,
                chunk,
                "failed",
                formatBrowserOperationError(caughtError, "Delete failed."),
              );
            }
            failure = caughtError;
          }
        },
        () => Boolean(failure),
      );
      if (failure) throw failure;
      return deletedCount;
    },
    [
      accountId,
      bucketName,
      enabled,
      parallelism,
      requestOptions,
      updateDeleteDetailsStatus,
    ],
  );

  const deleteFolder = useCallback(
    async (
      folder: BrowserItem,
    ): Promise<OperationCompletionStatus | undefined> => {
      if (!bucketName || !enabled || folder.type !== "folder") return;
      showOperations();
      const folderPrefix = normalizePrefix(folder.key);
      const operationId = startOperation(
        "deleting",
        "Deleting folder",
        `${bucketName}/${folderPrefix}`,
        { kind: "delete", cancelable: true },
        0,
      );
      const controller = createOperationController(operationId);
      let completionStatus: OperationCompletionStatus = "done";
      let completionError: string | undefined;
      let deletedCount = 0;
      let total = 0;
      try {
        const objects = await listAllObjectsForPrefix(
          folderPrefix,
          undefined,
          undefined,
          controller.signal,
        );
        const keys = Array.from(
          new Set([...objects.map((object) => object.key), folderPrefix]),
        );
        total = keys.length;
        if (keys.length === 0) {
          onStatus("Folder is empty.");
          return completionStatus;
        }
        const detailItems = objects.map((object) => {
          const relativeKey = object.key.startsWith(folderPrefix)
            ? object.key.slice(folderPrefix.length)
            : object.key;
          return {
            id: makeId(),
            key: object.key,
            label: relativeKey || object.key,
            status: "queued" as DeleteDetailStatus,
          };
        });
        if (detailItems.length === 0) {
          detailItems.push({
            id: makeId(),
            key: folderPrefix,
            label: folder.name || folderPrefix,
            status: "queued",
          });
        }
        setDeleteDetails((previous) => ({
          ...previous,
          [operationId]: detailItems,
        }));
        deletedCount = await deleteObjectsInBatches(
          keys,
          (deleted, itemCount) => {
            const progress =
              itemCount > 0
                ? Math.min(100, Math.round((deleted / itemCount) * 100))
                : 0;
            updateOperation(operationId, { progress });
          },
          operationId,
          controller.signal,
        );
        onStatus(`Deleted folder ${folder.name}`);
      } catch (caughtError) {
        if (isOperationAborted(caughtError, controller)) {
          completionStatus = "cancelled";
          cancelDeleteDetails(operationId);
          onStatus(
            `Delete cancelled after ${deletedCount} of ${total} item(s).`,
          );
          await onRefreshNow(prefix);
        } else {
          completionStatus = "failed";
          completionError = formatBrowserOperationError(
            caughtError,
            "Unable to delete folder.",
            "Unable to delete folder.",
          );
          onStatus(completionError);
        }
      } finally {
        clearOperationController(operationId);
        completeOperation(operationId, completionStatus, completionError);
      }
      return completionStatus;
    },
    [
      bucketName,
      cancelDeleteDetails,
      clearOperationController,
      completeOperation,
      createOperationController,
      deleteObjectsInBatches,
      enabled,
      isOperationAborted,
      listAllObjectsForPrefix,
      onRefreshNow,
      onStatus,
      prefix,
      setDeleteDetails,
      showOperations,
      startOperation,
      updateOperation,
    ],
  );

  const execute = useCallback(
    async (targets: BrowserItem[]) => {
      const fileTargets = targets.filter(
        (item) => item.type === "file" && !item.isDeleted,
      );
      const folderTargets = targets.filter(
        (item) => item.type === "folder" && !item.isDeleted,
      );
      if (fileTargets.length > 1 || folderTargets.length > 0) showOperations();
      try {
        let deleteCancelled = false;
        if (fileTargets.length > 0) {
          const targetPath =
            fileTargets.length === 1
              ? `${bucketName}/${fileTargets[0].key}`
              : currentPath || bucketName;
          const operationId = startOperation(
            "deleting",
            fileTargets.length === 1
              ? "Deleting object"
              : `Deleting ${fileTargets.length} objects`,
            targetPath,
            {
              kind: fileTargets.length > 1 ? "delete" : "other",
              cancelable: fileTargets.length > 1,
            },
            0,
          );
          const controller =
            fileTargets.length > 1
              ? createOperationController(operationId)
              : null;
          let completionStatus: OperationCompletionStatus = "done";
          let completionError: string | undefined;
          let deletedCount = 0;
          try {
            if (fileTargets.length > 1) {
              setDeleteDetails((previous) => ({
                ...previous,
                [operationId]: fileTargets.map((item) => ({
                  id: makeId(),
                  key: item.key,
                  label: item.name,
                  status: "queued",
                })),
              }));
            }
            deletedCount = await deleteObjectsInBatches(
              fileTargets.map((item) => item.key),
              (deleted, total) => {
                const progress =
                  total > 0
                    ? Math.min(100, Math.round((deleted / total) * 100))
                    : 0;
                updateOperation(operationId, { progress });
              },
              fileTargets.length > 1 ? operationId : undefined,
              controller?.signal,
            );
            onStatus(`Deleted ${fileTargets.length} object(s)`);
          } catch (caughtError) {
            if (isOperationAborted(caughtError, controller)) {
              completionStatus = "cancelled";
              cancelDeleteDetails(operationId);
              onStatus(
                `Delete cancelled after ${deletedCount} of ${fileTargets.length} item(s).`,
              );
              await onRefreshNow(prefix);
              deleteCancelled = true;
            } else {
              completionStatus = "failed";
              completionError = formatBrowserOperationError(
                caughtError,
                "Unable to delete selected objects.",
                "Unable to delete selected objects.",
              );
              onStatus(completionError);
            }
          } finally {
            if (controller) clearOperationController(operationId);
            completeOperation(operationId, completionStatus, completionError);
          }
        }
        if (deleteCancelled) return;

        for (const folder of folderTargets) {
          const folderStatus = await deleteFolder(folder);
          if (folderStatus === "cancelled") return;
        }
        const processedTargets = [...fileTargets, ...folderTargets];
        onProcessed(processedTargets);
        await onRefresh(prefix);
      } catch {
        onStatus("Unable to delete objects.");
      }
    },
    [
      bucketName,
      cancelDeleteDetails,
      clearOperationController,
      completeOperation,
      createOperationController,
      currentPath,
      deleteFolder,
      deleteObjectsInBatches,
      isOperationAborted,
      onProcessed,
      onRefresh,
      onRefreshNow,
      onStatus,
      prefix,
      setDeleteDetails,
      showOperations,
      startOperation,
      updateOperation,
    ],
  );

  const remove = useCallback(
    (targets: BrowserItem[]) => {
      if (!bucketName || !enabled || targets.length === 0) return;
      const fileTargets = targets.filter(
        (item) => item.type === "file" && !item.isDeleted,
      );
      const folderTargets = targets.filter(
        (item) => item.type === "folder" && !item.isDeleted,
      );
      onWarning(
        targets.some((item) => item.isDeleted)
          ? "Deleted items are shown from delete markers. Use versions to restore or remove markers."
          : null,
      );
      if (fileTargets.length === 0 && folderTargets.length === 0) return;
      onConfirm({
        title: "Delete objects",
        message:
          folderTargets.length > 0
            ? `Delete ${fileTargets.length} object(s) and ${folderTargets.length} folder(s)? This removes all objects within the selected folders.`
            : `Delete ${fileTargets.length} object(s)?`,
        confirmLabel: "Delete",
        tone: "danger",
        onConfirm: () => execute(targets),
      });
    },
    [bucketName, enabled, execute, onConfirm, onWarning],
  );

  return { deleteObjectsInBatches, remove };
}

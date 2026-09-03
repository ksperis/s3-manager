/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browser";
import type {
  PresignRequest,
  PresignedUrl,
} from "../../api/browserTransfers";
import { runWithConcurrency } from "../../utils/concurrency";
import { triggerBlobDownload } from "../../utils/download";
import {
  buildBrowserFolderDownloadPlan,
  downloadBrowserFolderArchive,
  resolveBrowserFolderArchiveLabel,
} from "./browserFolderDownload";
import {
  downloadBrowserTransferBlob,
  downloadBrowserTransferStream,
} from "./browserObjectTransferTransport";
import { formatBrowserOperationError } from "./browserOperationErrors";
import { updateOperationDetailById } from "./browserOperationDetailState";
import type { BrowserTransferReporter } from "./browserPageContract";
import type {
  BrowserItem,
  DownloadDetailStatus,
  OperationCompletionStatus,
} from "./browserTypes";
import { isAbortError, makeId, normalizePrefix } from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

type UseBrowserDownloadsOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  cancelDownloadDetails: OperationRegistry["cancelDownloadDetails"];
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  currentPath: string;
  enabled: boolean;
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  parallelism: number;
  presignDownload: (
    bucket: string,
    payload: PresignRequest,
  ) => Promise<PresignedUrl>;
  requestOptions?: BrowserRequestOptions;
  setDownloadDetails: OperationRegistry["setDownloadDetails"];
  showOperations: () => void;
  sseActive: boolean;
  sseCustomerKeyBase64: string | null;
  startOperation: OperationRegistry["startOperation"];
  streamingZipThresholdMb: number;
  transferReporter?: BrowserTransferReporter;
  updateOperation: OperationRegistry["updateOperation"];
  useProxyTransfers: boolean;
};

export function useBrowserDownloads({
  accountId,
  bucketName,
  cancelDownloadDetails,
  clearOperationController,
  completeOperation,
  createOperationController,
  currentPath,
  enabled,
  listAllObjectsForPrefix,
  onStatus,
  onWarning,
  parallelism,
  presignDownload,
  requestOptions,
  setDownloadDetails,
  showOperations,
  sseActive,
  sseCustomerKeyBase64,
  startOperation,
  streamingZipThresholdMb,
  transferReporter,
  updateOperation,
  useProxyTransfers,
}: UseBrowserDownloadsOptions) {
  const startReportedTransfer = useCallback(
    (item: BrowserItem) =>
      transferReporter?.start({
        direction: "Download",
        bucketName,
        key: item.key,
        name: item.name || item.key,
        sizeBytes: item.sizeBytes,
      }) ?? null,
    [bucketName, transferReporter],
  );

  const downloadBlob = useCallback(
    async (key: string, signal?: AbortSignal) => {
      if (!bucketName || !enabled) throw new Error("Missing bucket context.");
      return downloadBrowserTransferBlob({
        selector: accountId,
        bucket: bucketName,
        key,
        mode: useProxyTransfers ? "proxy" : "direct",
        signal,
        sseCustomerKeyBase64,
        options: requestOptions,
        directPresign: (payload) => presignDownload(bucketName, payload),
      });
    },
    [
      accountId,
      bucketName,
      enabled,
      presignDownload,
      requestOptions,
      sseCustomerKeyBase64,
      useProxyTransfers,
    ],
  );

  const downloadStream = useCallback(
    async (key: string, signal?: AbortSignal) => {
      if (!bucketName || !enabled) throw new Error("Missing bucket context.");
      return downloadBrowserTransferStream({
        selector: accountId,
        bucket: bucketName,
        key,
        mode: useProxyTransfers ? "proxy" : "direct",
        signal,
        sseCustomerKeyBase64,
        options: requestOptions,
        directPresign: (payload) => presignDownload(bucketName, payload),
      });
    },
    [
      accountId,
      bucketName,
      enabled,
      presignDownload,
      requestOptions,
      sseCustomerKeyBase64,
      useProxyTransfers,
    ],
  );

  const updateDownloadDetail = useCallback(
    (
      operationId: string,
      detailId: string,
      status: DownloadDetailStatus,
      errorMessage?: string,
    ) => {
      setDownloadDetails((previous) =>
        updateOperationDetailById(
          previous,
          operationId,
          detailId,
          status,
          errorMessage,
        ),
      );
    },
    [setDownloadDetails],
  );

  const downloadFolder = useCallback(
    async (folder: BrowserItem) => {
      if (!bucketName || !enabled || folder.type !== "folder") return;
      showOperations();
      onWarning(null);
      const folderPrefix = normalizePrefix(folder.key);
      const folderLabel = resolveBrowserFolderArchiveLabel(
        folder.name,
        folderPrefix,
      );
      const operationId = startOperation(
        "downloading",
        "Preparing download",
        `${bucketName}/${folderPrefix}`,
        { kind: "download", cancelable: true },
      );
      const controller = createOperationController(operationId);
      let completionStatus: OperationCompletionStatus = "done";
      let completionError: string | undefined;
      try {
        const objects = await listAllObjectsForPrefix(folderPrefix);
        if (controller.signal.aborted) {
          completionStatus = "cancelled";
          onStatus(`Download cancelled for ${folderLabel}`);
          return;
        }
        const plan = buildBrowserFolderDownloadPlan(
          objects,
          folderPrefix,
          makeId,
        );
        if (plan.targets.length === 0) {
          onStatus("Folder is empty.");
          return;
        }
        setDownloadDetails((previous) => ({
          ...previous,
          [operationId]: plan.targets.map((target) => ({
            id: target.detailId,
            key: target.key,
            label: target.relativeKey,
            status: "queued",
            sizeBytes: target.sizeBytes,
          })),
        }));
        const archiveResult = await downloadBrowserFolderArchive({
          controller,
          downloadBlob,
          downloadStream,
          folderLabel,
          onDetailChange: (detailId, status, errorMessage) =>
            updateDownloadDetail(
              operationId,
              detailId,
              status,
              errorMessage,
            ),
          onPhaseChange: (label) => updateOperation(operationId, { label }),
          onProgress: (progress) => updateOperation(operationId, { progress }),
          parallelism,
          streamingThresholdBytes:
            Math.max(0, streamingZipThresholdMb) * 1024 * 1024,
          targets: plan.targets,
          totalBytes: plan.totalBytes,
        });
        if (archiveResult.cancelled) {
          completionStatus = "cancelled";
          onStatus(`Download cancelled for ${folderLabel}`);
          cancelDownloadDetails(operationId);
          return;
        }
        if (archiveResult.failedKeys.length > 0) {
          completionStatus = "failed";
          completionError = `Downloaded ${folderLabel} with ${archiveResult.failedKeys.length} failed file(s).`;
          onStatus(completionError);
        } else {
          onStatus(`Downloaded ${folderLabel}`);
        }
      } catch (caughtError) {
        if (isAbortError(caughtError) || controller.signal.aborted) {
          completionStatus = "cancelled";
          onStatus(`Download cancelled for ${folderLabel}`);
        } else {
          completionStatus = "failed";
          console.error(caughtError);
          completionError = formatBrowserOperationError(
            caughtError,
            "Unable to download folder.",
            "Unable to download folder.",
          );
          onStatus(completionError);
        }
      } finally {
        clearOperationController(operationId);
        completeOperation(operationId, completionStatus, completionError);
      }
    },
    [
      bucketName,
      cancelDownloadDetails,
      clearOperationController,
      completeOperation,
      createOperationController,
      downloadBlob,
      downloadStream,
      enabled,
      listAllObjectsForPrefix,
      onStatus,
      onWarning,
      parallelism,
      setDownloadDetails,
      showOperations,
      startOperation,
      streamingZipThresholdMb,
      updateDownloadDetail,
      updateOperation,
    ],
  );

  const downloadMultipleFiles = useCallback(
    async (files: BrowserItem[]) => {
      showOperations();
      const operationId = startOperation(
        "downloading",
        `Downloading ${files.length} files`,
        currentPath || bucketName,
        { kind: "download", cancelable: true },
      );
      const controller = createOperationController(operationId);
      let completionStatus: OperationCompletionStatus = "done";
      let completionError: string | undefined;
      const targets = files.map((item) => ({ item, detailId: makeId() }));
      setDownloadDetails((previous) => ({
        ...previous,
        [operationId]: targets.map((target) => ({
          id: target.detailId,
          key: target.item.key,
          label: target.item.name,
          status: "queued",
          sizeBytes: target.item.sizeBytes ?? undefined,
        })),
      }));
      const totalBytes = targets.reduce(
        (sum, target) => sum + (target.item.sizeBytes ?? 0),
        0,
      );
      let downloadedBytes = 0;
      let completed = 0;
      let aborted = false;
      let failedCount = 0;
      const updateProgress = () => {
        const base =
          totalBytes > 0
            ? downloadedBytes / totalBytes
            : completed / targets.length;
        updateOperation(operationId, {
          progress: Math.min(100, Math.round(base * 100)),
        });
      };
      try {
        await runWithConcurrency(
          targets,
          parallelism,
          async (target) => {
            if (controller.signal.aborted) {
              aborted = true;
              return;
            }
            updateDownloadDetail(operationId, target.detailId, "downloading");
            const reportedId = startReportedTransfer(target.item);
            try {
              const blob = await downloadBlob(
                target.item.key,
                controller.signal,
              );
              triggerBlobDownload(target.item.name || "download", blob);
              updateDownloadDetail(operationId, target.detailId, "done");
              if (reportedId) {
                transferReporter?.complete(
                  reportedId,
                  target.item.name || "download",
                );
              }
            } catch (caughtError) {
              if (isAbortError(caughtError) || controller.signal.aborted) {
                updateDownloadDetail(
                  operationId,
                  target.detailId,
                  "cancelled",
                );
                if (reportedId) {
                  transferReporter?.fail(reportedId, "Download cancelled.");
                }
                aborted = true;
                controller.abort();
                return;
              }
              console.error(caughtError);
              const errorMessage = formatBrowserOperationError(
                caughtError,
                "Download failed.",
              );
              updateDownloadDetail(
                operationId,
                target.detailId,
                "failed",
                errorMessage,
              );
              if (reportedId) transferReporter?.fail(reportedId, errorMessage);
              failedCount += 1;
            } finally {
              completed += 1;
              downloadedBytes += target.item.sizeBytes ?? 0;
              updateProgress();
            }
          },
          () => aborted,
        );
        if (aborted || controller.signal.aborted) {
          completionStatus = "cancelled";
          onStatus("Download cancelled.");
          cancelDownloadDetails(operationId);
          return;
        }
        updateOperation(operationId, { progress: 100 });
        onStatus(`Downloaded ${files.length} files`);
        if (failedCount > 0) {
          completionStatus = "failed";
          completionError = `Downloaded ${files.length - failedCount} of ${files.length} files.`;
          onStatus(completionError);
        }
      } catch (caughtError) {
        if (isAbortError(caughtError) || controller.signal.aborted) {
          completionStatus = "cancelled";
          onStatus("Download cancelled.");
        } else {
          completionStatus = "failed";
          completionError = formatBrowserOperationError(
            caughtError,
            "Unable to download files.",
            "Unable to download files.",
          );
          onStatus(completionError);
        }
      } finally {
        clearOperationController(operationId);
        completeOperation(operationId, completionStatus, completionError);
      }
    },
    [
      bucketName,
      cancelDownloadDetails,
      clearOperationController,
      completeOperation,
      createOperationController,
      currentPath,
      downloadBlob,
      onStatus,
      parallelism,
      setDownloadDetails,
      showOperations,
      startOperation,
      startReportedTransfer,
      transferReporter,
      updateDownloadDetail,
      updateOperation,
    ],
  );

  const downloadItems = useCallback(
    async (items: BrowserItem[]) => {
      if (!bucketName || !enabled || items.length === 0) return;
      const files = items.filter(
        (item) => item.type === "file" && !item.isDeleted,
      );
      const deletedCount = items.filter(
        (item) => item.type === "file" && item.isDeleted,
      ).length;
      if (files.length === 0) {
        if (deletedCount > 0) {
          onWarning("Deleted objects cannot be downloaded directly.");
        }
        return;
      }
      onWarning(
        deletedCount > 0
          ? "Deleted objects were skipped. Open versions to restore before download."
          : null,
      );
      if (files.length > 1) {
        await downloadMultipleFiles(files);
        return;
      }
      const item = files[0];
      try {
        if (useProxyTransfers || sseActive) {
          const reportedId = startReportedTransfer(item);
          try {
            const blob = await downloadBlob(item.key);
            triggerBlobDownload(item.name || "download", blob);
            if (reportedId) {
              transferReporter?.complete(reportedId, item.name || "download");
            }
          } catch (caughtError) {
            if (reportedId) {
              transferReporter?.fail(
                reportedId,
                formatBrowserOperationError(
                  caughtError,
                  "Unable to download object.",
                ),
              );
            }
            throw caughtError;
          }
        } else {
          const presign = await presignDownload(bucketName, {
            key: item.key,
            operation: "get_object",
            expires_in: 900,
          });
          window.open(presign.url, "_blank");
        }
      } catch {
        onStatus(
          useProxyTransfers || sseActive
            ? "Unable to download object."
            : "Unable to generate download URL.",
        );
      }
    },
    [
      bucketName,
      downloadBlob,
      downloadMultipleFiles,
      enabled,
      onStatus,
      onWarning,
      presignDownload,
      sseActive,
      startReportedTransfer,
      transferReporter,
      useProxyTransfers,
    ],
  );

  return { downloadFolder, downloadItems };
}

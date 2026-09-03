/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  copyObject,
  deleteObjects,
} from "../../api/browser";
import type { BrowserObjectVersion } from "../../api/browserContracts";
import { formatBrowserOperationError } from "./browserOperationErrors";
import type { OperationCompletionStatus } from "./browserTypes";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

type DeleteConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: "danger";
  onConfirm: () => Promise<void> | void;
};

type UseBrowserVersionActionsOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  enabled: boolean;
  isOperationAborted: OperationRegistry["isOperationAborted"];
  onConfirm: (confirmation: DeleteConfirmation) => void;
  onRefreshListing: (key: string) => Promise<void>;
  onRefreshVersions: (key: string) => Promise<void>;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  requestOptions?: BrowserRequestOptions;
  startOperation: OperationRegistry["startOperation"];
  versioningEnabled: boolean;
};

export function useBrowserVersionActions({
  accountId,
  bucketName,
  clearOperationController,
  completeOperation,
  createOperationController,
  enabled,
  isOperationAborted,
  onConfirm,
  onRefreshListing,
  onRefreshVersions,
  onStatus,
  onWarning,
  requestOptions,
  startOperation,
  versioningEnabled,
}: UseBrowserVersionActionsOptions) {
  const refresh = useCallback(
    async (key: string) => {
      await onRefreshListing(key);
      await onRefreshVersions(key);
    },
    [onRefreshListing, onRefreshVersions],
  );

  const restore = useCallback(
    async (version: BrowserObjectVersion) => {
      if (
        !bucketName ||
        !enabled ||
        !version.version_id ||
        version.is_delete_marker ||
        !versioningEnabled
      ) {
        return;
      }
      onWarning(null);
      const operationId = startOperation(
        "copying",
        "Restoring version",
        `${bucketName}/${version.key}`,
        { cancelable: true },
      );
      const controller = createOperationController(operationId);
      let completionStatus: OperationCompletionStatus = "done";
      let completionError: string | undefined;
      try {
        await copyObject(
          accountId,
          bucketName,
          {
            source_key: version.key,
            source_version_id: version.version_id,
            destination_key: version.key,
            replace_metadata: false,
            move: false,
          },
          controller.signal,
          requestOptions,
        );
        onStatus(`Restored version ${version.version_id}`);
        await refresh(version.key);
      } catch (caughtError) {
        if (isOperationAborted(caughtError, controller)) {
          completionStatus = "cancelled";
          onStatus("Restore version cancelled.");
          await refresh(version.key);
        } else {
          completionStatus = "failed";
          completionError = formatBrowserOperationError(
            caughtError,
            "Unable to restore version.",
            "Unable to restore version.",
          );
          onStatus(completionError);
        }
      } finally {
        clearOperationController(operationId);
        completeOperation(operationId, completionStatus, completionError);
      }
    },
    [
      accountId,
      bucketName,
      clearOperationController,
      completeOperation,
      createOperationController,
      enabled,
      isOperationAborted,
      onStatus,
      onWarning,
      refresh,
      requestOptions,
      startOperation,
      versioningEnabled,
    ],
  );

  const executeDelete = useCallback(
    async (version: BrowserObjectVersion) => {
      const isDeleteMarker = Boolean(version.is_delete_marker);
      const operationId = startOperation(
        "deleting",
        isDeleteMarker ? "Removing delete marker" : "Deleting version",
        `${bucketName}/${version.key}`,
        { cancelable: true },
      );
      const controller = createOperationController(operationId);
      let completionStatus: OperationCompletionStatus = "done";
      let completionError: string | undefined;
      try {
        await deleteObjects(
          accountId,
          bucketName,
          [{ key: version.key, version_id: version.version_id }],
          controller.signal,
          requestOptions,
        );
        onStatus(
          isDeleteMarker ? "Delete marker removed." : "Version deleted.",
        );
        await refresh(version.key);
      } catch (caughtError) {
        if (isOperationAborted(caughtError, controller)) {
          completionStatus = "cancelled";
          onStatus(
            isDeleteMarker
              ? "Delete marker removal cancelled."
              : "Delete version cancelled.",
          );
          await refresh(version.key);
        } else {
          completionStatus = "failed";
          const fallback = isDeleteMarker
            ? "Unable to delete marker."
            : "Unable to delete version.";
          completionError = formatBrowserOperationError(
            caughtError,
            fallback,
            fallback,
          );
          onWarning(completionError);
        }
      } finally {
        clearOperationController(operationId);
        completeOperation(operationId, completionStatus, completionError);
      }
    },
    [
      accountId,
      bucketName,
      clearOperationController,
      completeOperation,
      createOperationController,
      isOperationAborted,
      onStatus,
      onWarning,
      refresh,
      requestOptions,
      startOperation,
    ],
  );

  const remove = useCallback(
    (version: BrowserObjectVersion) => {
      if (
        !bucketName ||
        !enabled ||
        !version.version_id ||
        !versioningEnabled
      ) {
        return;
      }
      onWarning(null);
      const label = version.is_delete_marker ? "delete marker" : "version";
      onConfirm({
        title: `Delete ${label}`,
        message: `Delete ${label} for ${version.key}?`,
        confirmLabel: "Delete",
        tone: "danger",
        onConfirm: () => executeDelete(version),
      });
    },
    [
      bucketName,
      enabled,
      executeDelete,
      onConfirm,
      onWarning,
      versioningEnabled,
    ],
  );

  return { remove, restore };
}

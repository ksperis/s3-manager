/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { COMPLETED_OPERATIONS_LIMIT } from "./browserConstants";
import { cancelPendingOperationDetails } from "./browserOperationDetailState";
import {
  completeOperationById,
  patchOperationById,
  prependCompletedActivity,
} from "./browserOperationState";
import type {
  CopyDetailItem,
  DeleteDetailItem,
  DownloadDetailItem,
  OperationCompletionStatus,
  OperationItem,
} from "./browserTypes";
import { isAbortError, makeId } from "./browserUtils";

type RunningOperationKind = Exclude<
  NonNullable<OperationItem["kind"]>,
  "activity"
>;

type StartOperationOptions = {
  kind?: RunningOperationKind;
  groupId?: string;
  groupLabel?: string;
  groupKind?: OperationItem["groupKind"];
  itemLabel?: string;
  cancelable?: boolean;
  sizeBytes?: number;
};

function operationWasAborted(
  error: unknown,
  controller?: AbortController | null,
): boolean {
  return isAbortError(error) || Boolean(controller?.signal.aborted);
}

export function useBrowserOperationRegistry() {
  const [operations, setOperations] = useState<OperationItem[]>([]);
  const [downloadDetails, setDownloadDetails] = useState<
    Record<string, DownloadDetailItem[]>
  >({});
  const [deleteDetails, setDeleteDetails] = useState<
    Record<string, DeleteDetailItem[]>
  >({});
  const [copyDetails, setCopyDetails] = useState<
    Record<string, CopyDetailItem[]>
  >({});
  const operationControllersRef = useRef(new Map<string, AbortController>());

  useEffect(
    () => () => {
      operationControllersRef.current.forEach((controller) => {
        controller.abort();
      });
      operationControllersRef.current.clear();
    },
    [],
  );

  const startOperation = useCallback(
    (
      status: NonNullable<OperationItem["status"]>,
      label: string,
      path: string,
      options?: StartOperationOptions,
      progress = status === "uploading" || status === "downloading" ? 0 : 20,
    ) => {
      const operationId = makeId();
      setOperations((previous) => [
        {
          id: operationId,
          status,
          label,
          path,
          progress,
          sizeBytes: options?.sizeBytes,
          kind: options?.kind ?? "other",
          groupId: options?.groupId,
          groupLabel: options?.groupLabel,
          groupKind: options?.groupKind,
          itemLabel: options?.itemLabel,
          cancelable: options?.cancelable ?? false,
        },
        ...previous,
      ]);
      return operationId;
    },
    [],
  );

  const recordCompletedActivity = useCallback(
    (label: string, path: string) => {
      const completedAt = new Date().toLocaleTimeString();
      setOperations((previous) =>
        prependCompletedActivity(
          previous,
          {
            id: makeId(),
            label,
            path,
            progress: 100,
            kind: "activity",
            cancelable: false,
            completedAt,
            completionStatus: "done",
          },
          COMPLETED_OPERATIONS_LIMIT,
        ),
      );
    },
    [],
  );

  const updateOperation = useCallback(
    (
      operationId: string | null | undefined,
      patch: Partial<Omit<OperationItem, "id">>,
    ) => {
      setOperations((previous) =>
        patchOperationById(previous, operationId, patch),
      );
    },
    [],
  );

  const completeOperation = useCallback(
    (
      operationId: string,
      status: OperationCompletionStatus = "done",
      errorMessage?: string,
    ) => {
      const completedAt = new Date().toLocaleTimeString();
      setOperations((previous) =>
        completeOperationById(
          previous,
          operationId,
          status,
          completedAt,
          errorMessage,
        ),
      );
    },
    [],
  );

  const createOperationController = useCallback((operationId: string) => {
    operationControllersRef.current.get(operationId)?.abort();
    const controller = new AbortController();
    operationControllersRef.current.set(operationId, controller);
    return controller;
  }, []);

  const clearOperationController = useCallback((operationId: string) => {
    operationControllersRef.current.delete(operationId);
  }, []);

  const cancelOperationController = useCallback((operationId: string) => {
    operationControllersRef.current.get(operationId)?.abort();
  }, []);

  const cancelDownloadDetails = useCallback((operationId: string) => {
    setDownloadDetails((previous) =>
      cancelPendingOperationDetails(
        previous,
        operationId,
        "downloading",
        "cancelled",
      ),
    );
  }, []);

  const cancelCopyDetails = useCallback((operationId: string) => {
    setCopyDetails((previous) =>
      cancelPendingOperationDetails(
        previous,
        operationId,
        "copying",
        "cancelled",
      ),
    );
  }, []);

  const cancelDeleteDetails = useCallback((operationId: string) => {
    setDeleteDetails((previous) =>
      cancelPendingOperationDetails(
        previous,
        operationId,
        "deleting",
        "cancelled",
      ),
    );
  }, []);

  const cancelOperation = useCallback(
    (operationId: string) => {
      cancelOperationController(operationId);
      cancelDownloadDetails(operationId);
      cancelCopyDetails(operationId);
      cancelDeleteDetails(operationId);
    },
    [
      cancelCopyDetails,
      cancelDeleteDetails,
      cancelDownloadDetails,
      cancelOperationController,
    ],
  );

  return {
    cancelCopyDetails,
    cancelDeleteDetails,
    cancelDownloadDetails,
    cancelOperation,
    cancelOperationController,
    clearOperationController,
    completeOperation,
    copyDetails,
    createOperationController,
    deleteDetails,
    downloadDetails,
    isOperationAborted: operationWasAborted,
    operations,
    recordCompletedActivity,
    setCopyDetails,
    setDeleteDetails,
    setDownloadDetails,
    setOperations,
    startOperation,
    updateOperation,
  };
}

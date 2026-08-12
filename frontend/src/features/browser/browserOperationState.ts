/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

import type {
  OperationCompletionStatus,
  OperationItem,
} from "./browserTypes";

type OperationPatch = Partial<Omit<OperationItem, "id">>;

export function patchOperationById(
  operations: OperationItem[],
  operationId: string | null | undefined,
  patch: OperationPatch,
): OperationItem[] {
  if (!operationId) return operations;
  return operations.map((operation) =>
    operation.id === operationId ? { ...operation, ...patch } : operation,
  );
}

export function completeOperationById(
  operations: OperationItem[],
  operationId: string,
  status: OperationCompletionStatus,
  completedAt: string,
  errorMessage?: string,
): OperationItem[] {
  return operations.map((operation) =>
    operation.id === operationId
      ? {
          ...operation,
          progress: 100,
          cancelable: false,
          completedAt,
          completionStatus: status,
          errorMessage:
            status === "failed"
              ? (errorMessage ?? operation.errorMessage)
              : undefined,
        }
      : operation,
  );
}

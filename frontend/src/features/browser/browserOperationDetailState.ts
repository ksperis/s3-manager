/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

type OperationDetailItem<TStatus extends string> = {
  id: string;
  key: string;
  status: TStatus;
  errorMessage?: string;
};

function updateMatchingOperationDetails<
  TStatus extends string,
  TItem extends OperationDetailItem<TStatus>,
>(
  records: Record<string, TItem[]>,
  operationId: string,
  matches: (item: TItem) => boolean,
  status: TStatus,
  errorMessage?: string,
): Record<string, TItem[]> {
  const items = records[operationId];
  if (!items) return records;
  return {
    ...records,
    [operationId]: items.map((item) =>
      matches(item)
        ? {
            ...item,
            status,
            errorMessage:
              status === "failed"
                ? (errorMessage ?? item.errorMessage)
                : undefined,
          }
        : item,
    ),
  };
}

export function updateOperationDetailById<
  TStatus extends string,
  TItem extends OperationDetailItem<TStatus>,
>(
  records: Record<string, TItem[]>,
  operationId: string,
  detailId: string,
  status: TStatus,
  errorMessage?: string,
): Record<string, TItem[]> {
  return updateMatchingOperationDetails(
    records,
    operationId,
    (item) => item.id === detailId,
    status,
    errorMessage,
  );
}

export function updateOperationDetailsByKey<
  TStatus extends string,
  TItem extends OperationDetailItem<TStatus>,
>(
  records: Record<string, TItem[]>,
  operationId: string,
  keys: string[],
  status: TStatus,
  errorMessage?: string,
): Record<string, TItem[]> {
  const keySet = new Set(keys);
  return updateMatchingOperationDetails(
    records,
    operationId,
    (item) => keySet.has(item.key),
    status,
    errorMessage,
  );
}

export function cancelPendingOperationDetails<
  TItem extends OperationDetailItem<string>,
>(
  records: Record<string, TItem[]>,
  operationId: string,
  activeStatus: TItem["status"],
  cancelledStatus: TItem["status"],
): Record<string, TItem[]> {
  return updateMatchingOperationDetails<TItem["status"], TItem>(
    records,
    operationId,
    (item) => item.status === "queued" || item.status === activeStatus,
    cancelledStatus,
  );
}

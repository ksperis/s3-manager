/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  CopyOperationGroup,
  DeleteOperationGroup,
  DownloadOperationGroup,
  OperationDetailsKind,
  OperationItem,
  UploadOperationGroup,
} from "./browserTypes";
import { formatDownloadTimestamp } from "../../utils/download";

type BrowserOperationDetailsExportInput = {
  kind: OperationDetailsKind;
  operationId: string;
  exportedAt: string;
  operations: OperationItem[];
  downloadGroups: DownloadOperationGroup[];
  deleteGroups: DeleteOperationGroup[];
  copyGroups: CopyOperationGroup[];
  uploadGroups: UploadOperationGroup[];
};

type BrowserOperationDetailsExport = {
  filename: string;
  payload: Record<string, unknown>;
};

type DetailOperationGroup =
  | DownloadOperationGroup
  | DeleteOperationGroup
  | CopyOperationGroup;

type UploadExportState =
  | "queued"
  | "uploading"
  | "done"
  | "failed"
  | "cancelled";

function normalizeOperation(operation: OperationItem) {
  return {
    id: operation.id,
    kind: operation.kind,
    label: operation.label,
    path: operation.path,
    status: operation.status,
    progress: operation.progress,
    completionStatus: operation.completionStatus,
    completedAt: operation.completedAt,
    errorMessage: operation.errorMessage,
  };
}

function buildDetailPayload(
  group: DetailOperationGroup,
  kind: "download" | "delete" | "copy",
  exportedAt: string,
): Record<string, unknown> {
  return {
    exportedAt,
    kind,
    operation: normalizeOperation(group.op),
    counts: group.counts,
    items: group.items.map((item) => ({
      id: item.id,
      key: item.key,
      label: item.label,
      status: item.status,
      ...("sizeBytes" in item ? { sizeBytes: item.sizeBytes } : {}),
      errorMessage: item.errorMessage,
    })),
  };
}

function buildUploadPayload(
  group: UploadOperationGroup,
  exportedAt: string,
): Record<string, unknown> {
  const items = [
    ...group.activeItems.map((item) => ({
      id: item.id,
      label: item.itemLabel ?? item.path,
      path: item.path,
      state: "uploading" as const,
      progress: item.progress,
      sizeBytes: item.sizeBytes,
      errorMessage: item.errorMessage,
      completedAt: item.completedAt,
    })),
    ...group.completedItems.map((item) => ({
      id: item.id,
      label: item.itemLabel ?? item.path,
      path: item.path,
      state: item.completionStatus ?? "done",
      progress: item.progress,
      sizeBytes: item.sizeBytes,
      errorMessage: item.errorMessage,
      completedAt: item.completedAt,
    })),
    ...group.queuedItems.map((item) => ({
      id: item.id,
      label: item.itemLabel ?? item.relativePath ?? item.key,
      path: `${item.bucket}/${item.key}`,
      state: "queued" as const,
      progress: 0,
      sizeBytes: item.file.size,
      errorMessage: undefined,
      completedAt: undefined,
    })),
  ];
  const counts = items.reduce<Record<UploadExportState | "total", number>>(
    (result, item) => {
      result.total += 1;
      result[item.state] += 1;
      return result;
    },
    { total: 0, queued: 0, uploading: 0, done: 0, failed: 0, cancelled: 0 },
  );
  return {
    exportedAt,
    kind: "upload",
    group: {
      id: group.id,
      label: group.label,
      kind: group.kind,
      progress: group.progress,
      totalBytes: group.totalBytes,
    },
    counts,
    items,
  };
}

function sanitizeFilename(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "operation";
}

export function buildBrowserOperationDetailsExport({
  kind,
  operationId,
  exportedAt,
  operations,
  downloadGroups,
  deleteGroups,
  copyGroups,
  uploadGroups,
}: BrowserOperationDetailsExportInput): BrowserOperationDetailsExport | null {
  let payload: Record<string, unknown> | null = null;
  if (kind === "download") {
    const group = downloadGroups.find((item) => item.op.id === operationId);
    payload = group ? buildDetailPayload(group, kind, exportedAt) : null;
  } else if (kind === "delete") {
    const group = deleteGroups.find((item) => item.op.id === operationId);
    payload = group ? buildDetailPayload(group, kind, exportedAt) : null;
  } else if (kind === "copy") {
    const group = copyGroups.find((item) => item.op.id === operationId);
    payload = group ? buildDetailPayload(group, kind, exportedAt) : null;
  } else if (kind === "upload") {
    const group = uploadGroups.find((item) => item.id === operationId);
    payload = group ? buildUploadPayload(group, exportedAt) : null;
  } else {
    const operation = operations.find((item) => item.id === operationId);
    payload = operation
      ? { exportedAt, kind, operation: normalizeOperation(operation) }
      : null;
  }
  if (!payload) return null;
  const timestamp = formatDownloadTimestamp(exportedAt);
  return {
    filename: `${sanitizeFilename(`operation-${kind}-${operationId}`)}-${timestamp}.json`,
    payload,
  };
}

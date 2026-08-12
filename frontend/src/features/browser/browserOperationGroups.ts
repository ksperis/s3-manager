/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  CopyDetailItem,
  CopyDetailStatus,
  CopyOperationGroup,
  DeleteDetailItem,
  DeleteDetailStatus,
  DeleteOperationGroup,
  DownloadDetailItem,
  DownloadDetailStatus,
  DownloadOperationGroup,
  OperationItem,
  UploadOperationGroup,
  UploadQueueItem,
} from "./browserTypes";

type DetailOperationGroup =
  | DownloadOperationGroup
  | DeleteOperationGroup
  | CopyOperationGroup;

type DetailGroupSummary = {
  queued: number;
  completed: number;
  failed: number;
};

type OperationGroupVisibility = {
  active: boolean;
  queued: boolean;
  completed: boolean;
  failed: boolean;
};

type OperationGroupSortIndexes = {
  operationById: Record<string, number>;
  uploadGroupById: Record<string, number>;
  fallback: number;
};

const DOWNLOAD_STATUSES: DownloadDetailStatus[] = [
  "queued",
  "downloading",
  "done",
  "failed",
  "cancelled",
];
const DELETE_STATUSES: DeleteDetailStatus[] = [
  "queued",
  "deleting",
  "done",
  "failed",
  "cancelled",
];
const COPY_STATUSES: CopyDetailStatus[] = [
  "queued",
  "copying",
  "done",
  "failed",
  "cancelled",
];

function countDetailStatuses<TStatus extends string>(
  items: Array<{ status: TStatus }>,
  statuses: TStatus[],
): Record<TStatus | "total", number> {
  const counts = Object.fromEntries([
    ["total", items.length],
    ...statuses.map((status) => [status, 0]),
  ]) as Record<TStatus | "total", number>;
  items.forEach((item) => {
    counts[item.status] += 1;
  });
  return counts;
}

function buildDetailOperationGroups<
  TItem extends { status: TStatus },
  TStatus extends string,
>(
  operations: OperationItem[],
  kind: "download" | "delete" | "copy",
  details: Record<string, TItem[]>,
  statuses: TStatus[],
): Array<{
  op: OperationItem;
  items: TItem[];
  counts: Record<TStatus | "total", number>;
}> {
  return operations
    .filter((operation) => operation.kind === kind)
    .map((operation) => {
      const items = details[operation.id] ?? [];
      return {
        op: operation,
        items,
        counts: countDetailStatuses(items, statuses),
      };
    });
}

export function buildDownloadOperationGroups(
  operations: OperationItem[],
  details: Record<string, DownloadDetailItem[]>,
): DownloadOperationGroup[] {
  return buildDetailOperationGroups<DownloadDetailItem, DownloadDetailStatus>(
    operations,
    "download",
    details,
    DOWNLOAD_STATUSES,
  );
}

export function buildDeleteOperationGroups(
  operations: OperationItem[],
  details: Record<string, DeleteDetailItem[]>,
): DeleteOperationGroup[] {
  return buildDetailOperationGroups<DeleteDetailItem, DeleteDetailStatus>(
    operations,
    "delete",
    details,
    DELETE_STATUSES,
  );
}

export function buildCopyOperationGroups(
  operations: OperationItem[],
  details: Record<string, CopyDetailItem[]>,
): CopyOperationGroup[] {
  return buildDetailOperationGroups<CopyDetailItem, CopyDetailStatus>(
    operations,
    "copy",
    details,
    COPY_STATUSES,
  );
}

export function buildUploadOperationGroups(
  operations: OperationItem[],
  uploadQueue: UploadQueueItem[],
): UploadOperationGroup[] {
  const groups = new Map<string, UploadOperationGroup>();
  operations
    .filter((operation) => operation.kind === "upload")
    .forEach((operation) => {
      const groupId = operation.groupId ?? operation.id;
      const existing = groups.get(groupId);
      const isCompleted = Boolean(operation.completedAt);
      if (existing) {
        (isCompleted ? existing.completedItems : existing.activeItems).push(
          operation,
        );
        existing.cancelable = existing.cancelable || Boolean(operation.cancelable);
        return;
      }
      groups.set(groupId, {
        id: groupId,
        label: operation.groupLabel ?? "Files",
        kind: operation.groupKind ?? "files",
        activeItems: isCompleted ? [] : [operation],
        completedItems: isCompleted ? [operation] : [],
        queuedItems: [],
        cancelable: Boolean(operation.cancelable),
        progress: 0,
        totalBytes: 0,
      });
    });
  uploadQueue.forEach((item) => {
    const existing = groups.get(item.groupId);
    if (existing) {
      existing.queuedItems.push(item);
      return;
    }
    groups.set(item.groupId, {
      id: item.groupId,
      label: item.groupLabel,
      kind: item.groupKind,
      activeItems: [],
      completedItems: [],
      queuedItems: [item],
      cancelable: false,
      progress: 0,
      totalBytes: 0,
    });
  });
  return Array.from(groups.values()).map((group) => {
    const activeBytes = group.activeItems.reduce(
      (sum, item) => sum + (item.sizeBytes ?? 0),
      0,
    );
    const completedBytes = group.completedItems.reduce(
      (sum, item) => sum + (item.sizeBytes ?? 0),
      0,
    );
    const queuedBytes = group.queuedItems.reduce(
      (sum, item) => sum + item.file.size,
      0,
    );
    const totalBytes = activeBytes + completedBytes + queuedBytes;
    const activeLoadedBytes = group.activeItems.reduce((sum, item) => {
      const progress = Math.min(100, Math.max(0, item.progress));
      return sum + ((item.sizeBytes ?? 0) * progress) / 100;
    }, 0);
    const progress =
      totalBytes > 0
        ? Math.round(((activeLoadedBytes + completedBytes) / totalBytes) * 100)
        : 0;
    return { ...group, progress, totalBytes };
  });
}

export function summarizeDetailOperationGroups(
  groups: DetailOperationGroup[],
): DetailGroupSummary {
  return groups.reduce<DetailGroupSummary>(
    (summary, group) => {
      const queuedItems = group.items.filter(
        (item) => item.status === "queued",
      ).length;
      const failedItems = group.items.filter(
        (item) => item.status === "failed",
      ).length;
      const completedItems = group.items.filter(
        (item) => item.status === "done" || item.status === "cancelled",
      ).length;
      summary.queued += queuedItems;
      const failedFallback =
        failedItems === 0 && group.op.completionStatus === "failed" ? 1 : 0;
      const completedFallback =
        completedItems === 0 &&
        group.op.completedAt &&
        group.op.completionStatus !== "failed"
          ? 1
          : 0;
      summary.failed += failedItems + failedFallback;
      summary.completed += completedItems + completedFallback;
      return summary;
    },
    { queued: 0, completed: 0, failed: 0 },
  );
}

export function filterUploadOperationGroups(
  groups: UploadOperationGroup[],
  visibility: OperationGroupVisibility,
): UploadOperationGroup[] {
  return groups.filter((group) => {
    const hasActive = group.activeItems.length > 0;
    const hasQueued = group.queuedItems.length > 0;
    const hasCompleted = group.completedItems.some(
      (item) => item.completionStatus !== "failed",
    );
    const hasFailed = group.completedItems.some(
      (item) => item.completionStatus === "failed",
    );
    return (
      (visibility.active && hasActive) ||
      (visibility.queued && hasQueued) ||
      (visibility.completed && hasCompleted) ||
      (visibility.failed && hasFailed)
    );
  });
}

export function filterDetailOperationGroups<
  TGroup extends { op: OperationItem; items: Array<{ status: string }> },
>(
  groups: TGroup[],
  activeStatus: "downloading" | "deleting" | "copying",
  visibility: OperationGroupVisibility,
): TGroup[] {
  return groups.filter((group) => {
    const hasActive =
      !group.op.completedAt &&
      (group.op.status === activeStatus ||
        group.items.some((item) => item.status === activeStatus));
    const hasQueued = group.items.some((item) => item.status === "queued");
    const hasCompleted =
      group.items.some(
        (item) => item.status === "done" || item.status === "cancelled",
      ) ||
      (Boolean(group.op.completedAt) &&
        group.op.completionStatus !== "failed");
    const hasFailed =
      group.items.some((item) => item.status === "failed") ||
      group.op.completionStatus === "failed";
    return (
      (visibility.active && hasActive) ||
      (visibility.queued && hasQueued) ||
      (visibility.completed && hasCompleted) ||
      (visibility.failed && hasFailed)
    );
  });
}

export function buildOperationGroupSortIndexes(
  operations: OperationItem[],
  uploadQueue: UploadQueueItem[],
  uploadGroups: UploadOperationGroup[],
): OperationGroupSortIndexes {
  const operationById: Record<string, number> = {};
  operations.forEach((operation, index) => {
    operationById[operation.id] = operations.length - index;
  });
  const queuedUploadGroupById: Record<string, number> = {};
  uploadQueue.forEach((item, index) => {
    if (queuedUploadGroupById[item.groupId] == null) {
      queuedUploadGroupById[item.groupId] = uploadQueue.length - index;
    }
  });
  const uploadGroupById: Record<string, number> = {};
  uploadGroups.forEach((group) => {
    const operationIndexes = [
      ...group.activeItems,
      ...group.completedItems,
    ]
      .map((item) => operationById[item.id])
      .filter((value): value is number => typeof value === "number");
    uploadGroupById[group.id] =
      operationIndexes.length > 0
        ? Math.max(...operationIndexes)
        : (queuedUploadGroupById[group.id] ?? 0);
  });
  return {
    operationById,
    uploadGroupById,
    fallback: operations.length + uploadQueue.length + 1000,
  };
}

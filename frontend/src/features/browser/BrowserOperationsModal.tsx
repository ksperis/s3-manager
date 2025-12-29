/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import Modal from "../../components/Modal";
import { formatBytes } from "../../utils/format";
import {
  countBadgeClasses,
  DEFAULT_QUEUED_VISIBLE_COUNT,
  filterChipActiveClasses,
  filterChipClasses,
  operationSecondaryClasses,
  operationStopClasses,
} from "./browserConstants";
import { formatBadgeCount } from "./browserUtils";
import type {
  CompletedOperationItem,
  CopyDetailItem,
  CopyDetailStatus,
  DeleteDetailItem,
  DeleteDetailStatus,
  DownloadDetailItem,
  DownloadDetailStatus,
  OperationItem,
  UploadQueueItem,
} from "./browserTypes";

type DownloadGroup = {
  op: OperationItem;
  items: DownloadDetailItem[];
  counts: Record<DownloadDetailStatus | "total", number>;
};

type DeleteGroup = {
  op: OperationItem;
  items: DeleteDetailItem[];
  counts: Record<DeleteDetailStatus | "total", number>;
};

type CopyGroup = {
  op: OperationItem;
  items: CopyDetailItem[];
  counts: Record<CopyDetailStatus | "total", number>;
};

type UploadGroup = {
  id: string;
  label: string;
  kind: "folder" | "files";
  activeItems: OperationItem[];
  completedItems: OperationItem[];
  queuedItems: UploadQueueItem[];
  cancelable: boolean;
  progress: number;
  totalBytes: number;
};

type BrowserOperationsModalProps = {
  totalOperationsCount: number;
  activeOperationsCount: number;
  queuedOperationsCount: number;
  completedOperationsCount: number;
  showActiveOperations: boolean;
  showQueuedOperations: boolean;
  showCompletedOperations: boolean;
  onToggleActive: () => void;
  onToggleQueued: () => void;
  onToggleCompleted: () => void;
  visibleDownloadGroups: DownloadGroup[];
  visibleDeleteGroups: DeleteGroup[];
  visibleCopyGroups: CopyGroup[];
  visibleUploadGroups: UploadGroup[];
  visibleOtherOperations: OperationItem[];
  completedOperations: CompletedOperationItem[];
  isGroupExpanded: (groupId: string) => boolean;
  toggleGroupExpanded: (groupId: string) => void;
  getSectionVisibleCount: (groupId: string, section: "queued" | "completed") => number;
  showMoreSection: (groupId: string, section: "queued" | "completed") => void;
  cancelOperation: (operationId: string) => void;
  cancelUploadGroup: (groupId: string) => void;
  cancelUploadOperation: (operationId: string) => void;
  removeQueuedUpload: (uploadId: string) => void;
  onClose: () => void;
};

export default function BrowserOperationsModal({
  totalOperationsCount,
  activeOperationsCount,
  queuedOperationsCount,
  completedOperationsCount,
  showActiveOperations,
  showQueuedOperations,
  showCompletedOperations,
  onToggleActive,
  onToggleQueued,
  onToggleCompleted,
  visibleDownloadGroups,
  visibleDeleteGroups,
  visibleCopyGroups,
  visibleUploadGroups,
  visibleOtherOperations,
  completedOperations,
  isGroupExpanded,
  toggleGroupExpanded,
  getSectionVisibleCount,
  showMoreSection,
  cancelOperation,
  cancelUploadGroup,
  cancelUploadOperation,
  removeQueuedUpload,
  onClose,
}: BrowserOperationsModalProps) {
  const operationsPanelHeightClasses = "h-[240px]";
  const operationsListAreaClasses = "flex-1 overflow-y-auto pr-1";

  const hasVisibleCompletedActivity = showCompletedOperations && completedOperations.length > 0;
  const hasVisibleOperations =
    visibleUploadGroups.length > 0 ||
    visibleDownloadGroups.length > 0 ||
    visibleDeleteGroups.length > 0 ||
    visibleCopyGroups.length > 0 ||
    visibleOtherOperations.length > 0 ||
    hasVisibleCompletedActivity;

  const statusLabel = (status: OperationItem["status"]) => {
    if (status === "uploading") return "Uploading";
    if (status === "downloading") return "Downloading";
    if (status === "copying") return "Copying";
    return "Deleting";
  };

  const statusClasses = (status: OperationItem["status"]) => {
    if (status === "uploading") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200";
    if (status === "downloading") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200";
    if (status === "copying") return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200";
    return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200";
  };

  const completionLabel = (status?: OperationItem["completionStatus"]) => {
    if (status === "failed") return "Failed";
    if (status === "cancelled") return "Cancelled";
    return "Completed";
  };

  const completionClasses = (status?: OperationItem["completionStatus"]) => {
    if (status === "failed") {
      return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200";
    }
    if (status === "cancelled") {
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200";
    }
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200";
  };

  return (
    <Modal title="Operations overview" onClose={onClose} maxWidthClass="max-w-3xl">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Operations</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Uploads, downloads, deletions, copies, and queued files.
            </p>
          </div>
          <span className={countBadgeClasses}>{formatBadgeCount(totalOperationsCount)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onToggleActive}
            className={`${filterChipClasses} text-[10px] ${showActiveOperations ? filterChipActiveClasses : ""}`}
          >
            Active
            <span className={countBadgeClasses}>{formatBadgeCount(activeOperationsCount)}</span>
          </button>
          <button
            type="button"
            onClick={onToggleQueued}
            className={`${filterChipClasses} text-[10px] ${showQueuedOperations ? filterChipActiveClasses : ""}`}
          >
            Queue
            <span className={countBadgeClasses}>{formatBadgeCount(queuedOperationsCount)}</span>
          </button>
          <button
            type="button"
            onClick={onToggleCompleted}
            className={`${filterChipClasses} text-[10px] ${showCompletedOperations ? filterChipActiveClasses : ""}`}
          >
            Completed
            <span className={countBadgeClasses}>{formatBadgeCount(completedOperationsCount)}</span>
          </button>
        </div>
        <div className={operationsPanelHeightClasses}>
          <div className="flex h-full flex-col gap-2">
            <div className={operationsListAreaClasses}>
              {!hasVisibleOperations ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                  No operations to show.
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleDownloadGroups.map((group) => {
                    const queuedItems = group.items.filter((item) => item.status === "queued");
                    const activeItems = group.items.filter((item) => item.status === "downloading");
                    const completedItems = group.items.filter(
                      (item) => item.status === "done" || item.status === "failed" || item.status === "cancelled"
                    );
                    const visibleQueuedItems = queuedItems.slice(
                      0,
                      getSectionVisibleCount(group.op.id, "queued")
                    );
                    const visibleCompletedItems = completedItems.slice(
                      0,
                      getSectionVisibleCount(group.op.id, "completed")
                    );
                    const hasMoreQueued = queuedItems.length > visibleQueuedItems.length;
                    const hasMoreCompleted = completedItems.length > visibleCompletedItems.length;
                    const completedCount = completedItems.length;
                    return (
                      <div key={group.op.id} className="rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              {group.op.path}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {group.counts.downloading} active · {group.counts.queued} queued · {completedCount} completed ·{" "}
                              {group.op.progress}%
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className={operationSecondaryClasses}
                              onClick={() => toggleGroupExpanded(group.op.id)}
                            >
                              {isGroupExpanded(group.op.id) ? "Hide files" : "Show files"}
                            </button>
                            {group.op.cancelable && !group.op.completedAt && (
                              <button
                                type="button"
                                className={operationStopClasses}
                                onClick={() => cancelOperation(group.op.id)}
                              >
                                Stop
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div className="h-full bg-primary-500" style={{ width: `${group.op.progress}%` }} />
                        </div>
                        {isGroupExpanded(group.op.id) && (
                          <div className="mt-2 space-y-1.5">
                            {group.items.length === 0 ? (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {group.op.completedAt ? "No files found." : "Preparing download list..."}
                              </div>
                            ) : (
                              <>
                                {showActiveOperations &&
                                  activeItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </p>
                                        <p className="text-[10px] text-slate-400">
                                          Downloading
                                          {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                {showQueuedOperations &&
                                  visibleQueuedItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </p>
                                        <p className="text-[10px] text-slate-400">
                                          Queued
                                          {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                {showQueuedOperations && hasMoreQueued && (
                                  <button
                                    type="button"
                                    className={operationSecondaryClasses}
                                    onClick={() => showMoreSection(group.op.id, "queued")}
                                  >
                                    Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
                                  </button>
                                )}
                                {showCompletedOperations &&
                                  visibleCompletedItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </p>
                                        <p className="text-[10px] text-slate-400">
                                          {item.status === "done" && "Done"}
                                          {item.status === "failed" && "Failed"}
                                          {item.status === "cancelled" && "Cancelled"}
                                          {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                {showCompletedOperations && hasMoreCompleted && (
                                  <button
                                    type="button"
                                    className={operationSecondaryClasses}
                                    onClick={() => showMoreSection(group.op.id, "completed")}
                                  >
                                    Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {visibleDeleteGroups.map((group) => {
                    const queuedItems = group.items.filter((item) => item.status === "queued");
                    const activeItems = group.items.filter((item) => item.status === "deleting");
                    const completedItems = group.items.filter(
                      (item) => item.status === "done" || item.status === "failed"
                    );
                    const visibleQueuedItems = queuedItems.slice(
                      0,
                      getSectionVisibleCount(group.op.id, "queued")
                    );
                    const visibleCompletedItems = completedItems.slice(
                      0,
                      getSectionVisibleCount(group.op.id, "completed")
                    );
                    const hasMoreQueued = queuedItems.length > visibleQueuedItems.length;
                    const hasMoreCompleted = completedItems.length > visibleCompletedItems.length;
                    const completedCount = completedItems.length;
                    return (
                      <div key={group.op.id} className="rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              {group.op.path}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {group.counts.deleting} active · {group.counts.queued} queued · {completedCount} completed ·{" "}
                              {group.op.progress}%
                            </p>
                          </div>
                          <button
                            type="button"
                            className={operationSecondaryClasses}
                            onClick={() => toggleGroupExpanded(group.op.id)}
                          >
                            {isGroupExpanded(group.op.id) ? "Hide files" : "Show files"}
                          </button>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div className="h-full bg-primary-500" style={{ width: `${group.op.progress}%` }} />
                        </div>
                        {isGroupExpanded(group.op.id) && (
                          <div className="mt-2 space-y-1.5">
                            {group.items.length === 0 ? (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {group.op.completedAt ? "No items to delete." : "Preparing delete list..."}
                              </div>
                            ) : (
                              <>
                                {showActiveOperations &&
                                  activeItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </p>
                                        <p className="text-[10px] text-slate-400">Deleting</p>
                                      </div>
                                    </div>
                                  ))}
                                {showQueuedOperations &&
                                  visibleQueuedItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </p>
                                        <p className="text-[10px] text-slate-400">Queued</p>
                                      </div>
                                    </div>
                                  ))}
                                {showQueuedOperations && hasMoreQueued && (
                                  <button
                                    type="button"
                                    className={operationSecondaryClasses}
                                    onClick={() => showMoreSection(group.op.id, "queued")}
                                  >
                                    Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
                                  </button>
                                )}
                                {showCompletedOperations &&
                                  visibleCompletedItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </p>
                                        <p className="text-[10px] text-slate-400">
                                          {item.status === "done" && "Done"}
                                          {item.status === "failed" && "Failed"}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                {showCompletedOperations && hasMoreCompleted && (
                                  <button
                                    type="button"
                                    className={operationSecondaryClasses}
                                    onClick={() => showMoreSection(group.op.id, "completed")}
                                  >
                                    Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {visibleCopyGroups.map((group) => {
                    const queuedItems = group.items.filter((item) => item.status === "queued");
                    const activeItems = group.items.filter((item) => item.status === "copying");
                    const completedItems = group.items.filter((item) => item.status === "done" || item.status === "failed");
                    const visibleQueuedItems = queuedItems.slice(
                      0,
                      getSectionVisibleCount(group.op.id, "queued")
                    );
                    const visibleCompletedItems = completedItems.slice(
                      0,
                      getSectionVisibleCount(group.op.id, "completed")
                    );
                    const hasMoreQueued = queuedItems.length > visibleQueuedItems.length;
                    const hasMoreCompleted = completedItems.length > visibleCompletedItems.length;
                    const completedCount = completedItems.length;
                    return (
                      <div key={group.op.id} className="rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              {group.op.path}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {group.counts.copying} active · {group.counts.queued} queued · {completedCount} completed ·{" "}
                              {group.op.progress}%
                            </p>
                          </div>
                          <button
                            type="button"
                            className={operationSecondaryClasses}
                            onClick={() => toggleGroupExpanded(group.op.id)}
                          >
                            {isGroupExpanded(group.op.id) ? "Hide files" : "Show files"}
                          </button>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div className="h-full bg-primary-500" style={{ width: `${group.op.progress}%` }} />
                        </div>
                        {isGroupExpanded(group.op.id) && (
                          <div className="mt-2 space-y-1.5">
                            {group.items.length === 0 ? (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {group.op.completedAt ? "No items copied." : "Preparing copy list..."}
                              </div>
                            ) : (
                              <>
                                {showActiveOperations &&
                                  activeItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </p>
                                        <p className="text-[10px] text-slate-400">
                                          Copying
                                          {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                {showQueuedOperations &&
                                  visibleQueuedItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </p>
                                        <p className="text-[10px] text-slate-400">
                                          Queued
                                          {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                {showQueuedOperations && hasMoreQueued && (
                                  <button
                                    type="button"
                                    className={operationSecondaryClasses}
                                    onClick={() => showMoreSection(group.op.id, "queued")}
                                  >
                                    Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
                                  </button>
                                )}
                                {showCompletedOperations &&
                                  visibleCompletedItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </p>
                                        <p className="text-[10px] text-slate-400">
                                          {item.status === "done" && "Done"}
                                          {item.status === "failed" && "Failed"}
                                          {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                {showCompletedOperations && hasMoreCompleted && (
                                  <button
                                    type="button"
                                    className={operationSecondaryClasses}
                                    onClick={() => showMoreSection(group.op.id, "completed")}
                                  >
                                    Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {visibleUploadGroups.map((group) => {
                    const activeCount = group.activeItems.length;
                    const queuedCount = group.queuedItems.length;
                    const completedCount = group.completedItems.length;
                    const visibleQueuedItems = group.queuedItems.slice(
                      0,
                      getSectionVisibleCount(group.id, "queued")
                    );
                    const visibleCompletedItems = group.completedItems.slice(
                      0,
                      getSectionVisibleCount(group.id, "completed")
                    );
                    const hasMoreQueued = group.queuedItems.length > visibleQueuedItems.length;
                    const hasMoreCompleted = group.completedItems.length > visibleCompletedItems.length;
                    return (
                      <div key={group.id} className="rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              {group.kind === "folder" ? `Upload folder ${group.label}` : `Upload ${group.label}`}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {activeCount} active · {queuedCount} queued · {completedCount} completed · {group.progress}%
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className={operationSecondaryClasses}
                              onClick={() => toggleGroupExpanded(group.id)}
                            >
                              {isGroupExpanded(group.id) ? "Hide files" : "Show files"}
                            </button>
                            {(activeCount > 0 || queuedCount > 0) && (
                              <button
                                type="button"
                                className={operationStopClasses}
                                onClick={() => cancelUploadGroup(group.id)}
                              >
                                Stop all
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div className="h-full bg-primary-500" style={{ width: `${group.progress}%` }} />
                        </div>
                        {isGroupExpanded(group.id) && (
                          <div className="mt-2 space-y-1.5">
                            {showActiveOperations &&
                              group.activeItems.map((op) => (
                                <div key={op.id} className="flex items-center justify-between gap-3 text-xs">
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                      {op.itemLabel ?? op.path}
                                    </p>
                                    <p className="text-[10px] text-slate-400">
                                      Uploading · {op.progress > 0 ? `${op.progress}%` : "In progress"}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    className={operationStopClasses}
                                    onClick={() => cancelUploadOperation(op.id)}
                                    disabled={!op.cancelable}
                                  >
                                    Stop
                                  </button>
                                </div>
                              ))}
                            {showQueuedOperations &&
                              visibleQueuedItems.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                      {item.itemLabel || item.key}
                                    </p>
                                    <p className="text-[10px] text-slate-400">
                                      Queued · {formatBytes(item.file.size)}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    className={operationStopClasses}
                                    onClick={() => removeQueuedUpload(item.id)}
                                  >
                                    Stop
                                  </button>
                                </div>
                              ))}
                            {showQueuedOperations && hasMoreQueued && (
                              <button
                                type="button"
                                className={operationSecondaryClasses}
                                onClick={() => showMoreSection(group.id, "queued")}
                              >
                                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
                              </button>
                            )}
                            {showCompletedOperations &&
                              visibleCompletedItems.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                      {item.itemLabel ?? item.path}
                                    </p>
                                    <p className="text-[10px] text-slate-400">
                                      {completionLabel(item.completionStatus)}
                                      {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            {showCompletedOperations && hasMoreCompleted && (
                              <button
                                type="button"
                                className={operationSecondaryClasses}
                                onClick={() => showMoreSection(group.id, "completed")}
                              >
                                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {visibleOtherOperations.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Other operations</p>
                      {visibleOtherOperations.map((op) => {
                        const isCompleted = Boolean(op.completedAt);
                        return (
                          <div
                            key={op.id}
                            className="space-y-2 rounded-lg border border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses(op.status)}`}>
                                {statusLabel(op.status)}
                              </span>
                              <div className="flex items-center gap-2">
                                {isCompleted ? (
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${completionClasses(op.completionStatus)}`}>
                                    {completionLabel(op.completionStatus)}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {op.progress > 0 ? `${op.progress}%` : "In progress"}
                                  </span>
                                )}
                                {!isCompleted && op.cancelable && (
                                  <button
                                    type="button"
                                    className={operationStopClasses}
                                    onClick={() => cancelOperation(op.id)}
                                  >
                                    Stop
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{op.path}</p>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div className="h-full bg-primary-500" style={{ width: `${op.progress}%` }} />
                            </div>
                            <p className="text-[11px] text-slate-400">
                              {isCompleted ? `${completionLabel(op.completionStatus)}.` : `${op.label} in progress.`}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {showCompletedOperations && completedOperations.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Completed</p>
                      {completedOperations.map((activity) => (
                        <div
                          key={activity.id}
                          className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                        >
                          <div className="min-w-0 space-y-1">
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100">
                              Completed
                            </span>
                            <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                              {activity.label}
                            </p>
                            <p className="truncate text-[11px] text-slate-400">{activity.path}</p>
                          </div>
                          <span className="shrink-0 text-[11px] text-slate-400">{activity.when}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

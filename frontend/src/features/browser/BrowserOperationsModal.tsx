/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Fragment, useMemo, type ReactNode } from "react";
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
import { DownloadIcon } from "./browserIcons";
import { buildOperationStatusPill, operationCompletionLabel } from "./browserOperationStatus";
import { formatBadgeCount } from "./browserUtils";
import type {
  CopyOperationGroup,
  DeleteOperationGroup,
  DownloadOperationGroup,
  OperationDetailsKind,
  OperationItem,
  UploadOperationGroup,
} from "./browserTypes";

type BrowserOperationsModalProps = {
  totalOperationsCount: number;
  activeOperationsCount: number;
  queuedOperationsCount: number;
  completedOperationsCount: number;
  failedOperationsCount: number;
  showActiveOperations: boolean;
  showQueuedOperations: boolean;
  showCompletedOperations: boolean;
  showFailedOperations: boolean;
  filtersAllInactive: boolean;
  onToggleActive: () => void;
  onToggleQueued: () => void;
  onToggleCompleted: () => void;
  onToggleFailed: () => void;
  visibleDownloadGroups: DownloadOperationGroup[];
  visibleDeleteGroups: DeleteOperationGroup[];
  visibleCopyGroups: CopyOperationGroup[];
  visibleUploadGroups: UploadOperationGroup[];
  visibleOtherOperations: OperationItem[];
  operationSortIndexById: Record<string, number>;
  uploadGroupSortIndexById: Record<string, number>;
  operationSortFallback: number;
  isGroupExpanded: (groupId: string) => boolean;
  toggleGroupExpanded: (groupId: string) => void;
  getSectionVisibleCount: (groupId: string, section: "queued" | "completed" | "failed") => number;
  showMoreSection: (groupId: string, section: "queued" | "completed" | "failed") => void;
  cancelOperation: (operationId: string) => void;
  cancelUploadGroup: (groupId: string) => void;
  cancelUploadOperation: (operationId: string) => void;
  removeQueuedUpload: (uploadId: string) => void;
  onDownloadOperationDetails: (kind: OperationDetailsKind, operationId: string) => void;
  hasFinishedOperations: boolean;
  onClearFinishedOperations: () => void;
  onClose: () => void;
};

type OperationCardProps = {
  title: string;
  subtitle?: string;
  summary?: string;
  progress?: number;
  statusPill?: { label: string; classes: string };
  actions?: ReactNode;
  children?: ReactNode;
};

function OperationCard({ title, subtitle, summary, progress, statusPill, actions, children }: OperationCardProps) {
  return (
    <div className="border-b border-[color:var(--ui-border-soft)] py-3 last:border-b-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="ui-caption font-semibold text-[var(--ui-text)]">{title}</p>
          {subtitle && <p className="ui-caption text-[var(--ui-text-muted)]">{subtitle}</p>}
          {summary && <p className="ui-caption tabular-nums text-[var(--ui-text-muted)]">{summary}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-2 sm:flex-nowrap sm:justify-end sm:shrink-0">
          {statusPill && (
            <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 ui-caption font-semibold ${statusPill.classes}`}>
              {statusPill.label}
            </span>
          )}
          {actions}
        </div>
      </div>
      {typeof progress === "number" && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--ui-surface-muted)]">
          <div className="h-full bg-primary-500" style={{ width: `${progress}%` }} />
        </div>
      )}
      {children != null && <div className="mt-2 space-y-1.5">{children}</div>}
    </div>
  );
}

export default function BrowserOperationsModal(props: BrowserOperationsModalProps) {
  const {
    activeOperationsCount,
    queuedOperationsCount,
    completedOperationsCount,
    failedOperationsCount,
    showActiveOperations,
    showQueuedOperations,
    showCompletedOperations,
    showFailedOperations = false,
    filtersAllInactive,
    onToggleActive,
    onToggleQueued,
    onToggleCompleted,
    onToggleFailed,
    visibleDownloadGroups,
    visibleDeleteGroups,
    visibleCopyGroups,
    visibleUploadGroups,
    visibleOtherOperations,
    operationSortIndexById,
    uploadGroupSortIndexById,
    operationSortFallback,
    isGroupExpanded,
    toggleGroupExpanded,
    getSectionVisibleCount,
    showMoreSection,
    cancelOperation,
    cancelUploadGroup,
    cancelUploadOperation,
    removeQueuedUpload,
    onDownloadOperationDetails,
    hasFinishedOperations,
    onClearFinishedOperations,
    onClose,
  } = props;
  const operationsPanelHeightClasses = "max-h-[min(70vh,520px)]";
  const operationsListAreaClasses = "min-h-[12rem] flex-1 overflow-y-auto pr-1";

  const showAllOperations = filtersAllInactive;
  const showActiveSection = showAllOperations || showActiveOperations;
  const showQueuedSection = showAllOperations || showQueuedOperations;
  const showCompletedSection = showAllOperations || showCompletedOperations;
  const showFailedSection = showAllOperations || showFailedOperations;
  const hasVisibleOperations =
    visibleUploadGroups.length > 0 ||
    visibleDownloadGroups.length > 0 ||
    visibleDeleteGroups.length > 0 ||
    visibleCopyGroups.length > 0 ||
    visibleOtherOperations.length > 0;

  const failedFilterChipActiveClasses =
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-500/50 dark:bg-rose-900/30 dark:text-rose-100";
  const failedBadgeClasses = `${countBadgeClasses} ${showFailedOperations ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-100" : ""}`;
  const detailsIconButtonClasses =
    "inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200/70 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700/80 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200";

  const renderDetailsAction = (kind: OperationDetailsKind, operationId: string) => (
    <button
      type="button"
      className={detailsIconButtonClasses}
      onClick={() => onDownloadOperationDetails(kind, operationId)}
      title="Export details (JSON)"
      aria-label="Export operation details (JSON)"
    >
      <DownloadIcon className="h-3.5 w-3.5" />
    </button>
  );
  const renderDetailsTextAction = (kind: OperationDetailsKind, operationId: string) => (
    <button
      type="button"
      className={operationSecondaryClasses}
      onClick={() => onDownloadOperationDetails(kind, operationId)}
    >
      Download details (JSON)
    </button>
  );

  const timelineEntries = useMemo(() => {
    const entries = [
      ...visibleDownloadGroups.map((group) => ({
        key: `download:${group.op.id}`,
        type: "download" as const,
        group,
      })),
      ...visibleDeleteGroups.map((group) => ({
        key: `delete:${group.op.id}`,
        type: "delete" as const,
        group,
      })),
      ...visibleCopyGroups.map((group) => ({
        key: `copy:${group.op.id}`,
        type: "copy" as const,
        group,
      })),
      ...visibleUploadGroups.map((group) => ({
        key: `upload:${group.id}`,
        type: "upload" as const,
        group,
      })),
      ...visibleOtherOperations.map((op) => ({
        key: `other:${op.id}`,
        type: "other" as const,
        op,
      })),
    ];

    const resolveSortIndex = (
      entry: (typeof entries)[number],
    ): number => {
      if (entry.type === "upload") {
        return uploadGroupSortIndexById[entry.group.id] ?? -operationSortFallback;
      }
      const operationId = entry.type === "other" ? entry.op.id : entry.group.op.id;
      return operationSortIndexById[operationId] ?? -operationSortFallback;
    };

    return entries.sort(
      (a, b) => {
        const orderDelta = resolveSortIndex(b) - resolveSortIndex(a);
        if (orderDelta !== 0) {
          return orderDelta;
        }
        return a.key.localeCompare(b.key);
      },
    );
  }, [
    operationSortFallback,
    operationSortIndexById,
    uploadGroupSortIndexById,
    visibleCopyGroups,
    visibleDeleteGroups,
    visibleDownloadGroups,
    visibleOtherOperations,
    visibleUploadGroups,
  ]);
  const renderDownloadGroup = (group: DownloadOperationGroup) => {
    const queuedItems = group.items.filter((item) => item.status === "queued");
    const activeItems = group.items.filter((item) => item.status === "downloading");
    const completedItems = group.items.filter((item) => item.status === "done" || item.status === "cancelled");
    const failedItems = group.items.filter((item) => item.status === "failed");
    const completedCount = completedItems.length;
    const visibleQueuedItems = queuedItems.slice(0, getSectionVisibleCount(group.op.id, "queued"));
    const visibleCompletedItems = completedItems.slice(0, getSectionVisibleCount(group.op.id, "completed"));
    const visibleFailedItems = failedItems.slice(0, getSectionVisibleCount(group.op.id, "failed"));
    const hasMoreQueued = queuedItems.length > visibleQueuedItems.length;
    const hasMoreCompleted = completedItems.length > visibleCompletedItems.length;
    const hasMoreFailed = failedItems.length > visibleFailedItems.length;
    const failedCount = failedItems.length;
    const hasFailed = failedCount > 0 || group.op.completionStatus === "failed";
    const isCompleted = Boolean(group.op.completedAt);
    const queuedOnly = !isCompleted && activeItems.length === 0 && queuedItems.length > 0;
    const statusPill = buildOperationStatusPill({
      hasFailed,
      isCompleted,
      queuedOnly,
      status: group.op.status,
      completionStatus: group.op.completionStatus,
    });
    const actions = (
      <>
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
      </>
    );
    const details = isGroupExpanded(group.op.id) ? (
      group.items.length === 0 ? (
        <div className="space-y-1 ui-caption text-slate-500 dark:text-slate-400">
          <p>{group.op.completedAt ? "No files found." : "Preparing download list..."}</p>
          {group.op.completionStatus === "failed" && group.op.errorMessage && (
            <p className="text-rose-600 dark:text-rose-200">{group.op.errorMessage}</p>
          )}
          <div className="pt-1">
            {renderDetailsTextAction("download", group.op.id)}
          </div>
        </div>
      ) : (
        <>
          {showActiveSection &&
            activeItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">
                    Downloading
                    {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          {showQueuedSection &&
            visibleQueuedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">
                    Queued
                    {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          {showQueuedSection && hasMoreQueued && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={() => showMoreSection(group.op.id, "queued")}
              >
                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
              </button>
              {renderDetailsTextAction("download", group.op.id)}
            </div>
          )}
          {showCompletedSection &&
            visibleCompletedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">
                    {item.status === "done" && "Done"}
                    {item.status === "cancelled" && "Cancelled"}
                    {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          {showCompletedSection && hasMoreCompleted && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={() => showMoreSection(group.op.id, "completed")}
              >
                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
              </button>
              {renderDetailsTextAction("download", group.op.id)}
            </div>
          )}
          {showFailedSection &&
            visibleFailedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">
                    Failed
                    {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                  </p>
                  {item.errorMessage && (
                    <p className="ui-caption text-rose-600 dark:text-rose-200">{item.errorMessage}</p>
                  )}
                </div>
              </div>
            ))}
          {showFailedSection && hasMoreFailed && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={() => showMoreSection(group.op.id, "failed")}
              >
                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
              </button>
              {renderDetailsTextAction("download", group.op.id)}
            </div>
          )}
          {!((showQueuedSection && hasMoreQueued) || (showCompletedSection && hasMoreCompleted) || (showFailedSection && hasMoreFailed)) && (
            <div className="pt-1">
              {renderDetailsTextAction("download", group.op.id)}
            </div>
          )}
        </>
      )
    ) : null;

    return (
      <OperationCard
        key={group.op.id}
        title={group.op.label}
        subtitle={group.op.path}
        summary={`${group.counts.downloading} active · ${group.counts.queued} queued · ${completedCount} completed · ${failedCount} failed · ${group.op.progress}%`}
        progress={group.op.progress}
        statusPill={statusPill}
        actions={actions}
      >
        {details}
      </OperationCard>
    );
  };

  const renderDeleteGroup = (group: DeleteOperationGroup) => {
    const queuedItems = group.items.filter((item) => item.status === "queued");
    const activeItems = group.items.filter((item) => item.status === "deleting");
    const completedItems = group.items.filter(
      (item) => item.status === "done" || item.status === "cancelled",
    );
    const failedItems = group.items.filter((item) => item.status === "failed");
    const completedCount = completedItems.length;
    const visibleQueuedItems = queuedItems.slice(0, getSectionVisibleCount(group.op.id, "queued"));
    const visibleCompletedItems = completedItems.slice(0, getSectionVisibleCount(group.op.id, "completed"));
    const visibleFailedItems = failedItems.slice(0, getSectionVisibleCount(group.op.id, "failed"));
    const hasMoreQueued = queuedItems.length > visibleQueuedItems.length;
    const hasMoreCompleted = completedItems.length > visibleCompletedItems.length;
    const hasMoreFailed = failedItems.length > visibleFailedItems.length;
    const failedCount = failedItems.length;
    const hasFailed = failedCount > 0 || group.op.completionStatus === "failed";
    const isCompleted = Boolean(group.op.completedAt);
    const queuedOnly = !isCompleted && activeItems.length === 0 && queuedItems.length > 0;
    const statusPill = buildOperationStatusPill({
      hasFailed,
      isCompleted,
      queuedOnly,
      status: group.op.status,
      completionStatus: group.op.completionStatus,
    });
    const actions = (
      <>
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
            Stop all
          </button>
        )}
      </>
    );
    const details = isGroupExpanded(group.op.id) ? (
      group.items.length === 0 ? (
        <div className="space-y-1 ui-caption text-slate-500 dark:text-slate-400">
          <p>{group.op.completedAt ? "No items to delete." : "Preparing delete list..."}</p>
          {group.op.completionStatus === "failed" && group.op.errorMessage && (
            <p className="text-rose-600 dark:text-rose-200">{group.op.errorMessage}</p>
          )}
          <div className="pt-1">
            {renderDetailsTextAction("delete", group.op.id)}
          </div>
        </div>
      ) : (
        <>
          {showActiveSection &&
            activeItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">Deleting</p>
                </div>
              </div>
            ))}
          {showQueuedSection &&
            visibleQueuedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">Queued</p>
                </div>
              </div>
            ))}
          {showQueuedSection && hasMoreQueued && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={() => showMoreSection(group.op.id, "queued")}
              >
                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
              </button>
              {renderDetailsTextAction("delete", group.op.id)}
            </div>
          )}
          {showCompletedSection &&
            visibleCompletedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">
                    {item.status === "done" && "Done"}
                    {item.status === "cancelled" && "Cancelled"}
                  </p>
                </div>
              </div>
            ))}
          {showCompletedSection && hasMoreCompleted && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={() => showMoreSection(group.op.id, "completed")}
              >
                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
              </button>
              {renderDetailsTextAction("delete", group.op.id)}
            </div>
          )}
          {showFailedSection &&
            visibleFailedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">Failed</p>
                  {item.errorMessage && (
                    <p className="ui-caption text-rose-600 dark:text-rose-200">{item.errorMessage}</p>
                  )}
                </div>
              </div>
            ))}
          {showFailedSection && hasMoreFailed && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={() => showMoreSection(group.op.id, "failed")}
              >
                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
              </button>
              {renderDetailsTextAction("delete", group.op.id)}
            </div>
          )}
          {!((showQueuedSection && hasMoreQueued) || (showCompletedSection && hasMoreCompleted) || (showFailedSection && hasMoreFailed)) && (
            <div className="pt-1">
              {renderDetailsTextAction("delete", group.op.id)}
            </div>
          )}
        </>
      )
    ) : null;

    return (
      <OperationCard
        key={group.op.id}
        title={group.op.label}
        subtitle={group.op.path}
        summary={`${group.counts.deleting} active · ${group.counts.queued} queued · ${completedCount} completed · ${failedCount} failed · ${group.op.progress}%`}
        progress={group.op.progress}
        statusPill={statusPill}
        actions={actions}
      >
        {details}
      </OperationCard>
    );
  };

  const renderCopyGroup = (group: CopyOperationGroup) => {
    const queuedItems = group.items.filter((item) => item.status === "queued");
    const activeItems = group.items.filter((item) => item.status === "copying");
    const completedItems = group.items.filter(
      (item) => item.status === "done" || item.status === "cancelled",
    );
    const failedItems = group.items.filter((item) => item.status === "failed");
    const completedCount = completedItems.length;
    const visibleQueuedItems = queuedItems.slice(0, getSectionVisibleCount(group.op.id, "queued"));
    const visibleCompletedItems = completedItems.slice(0, getSectionVisibleCount(group.op.id, "completed"));
    const visibleFailedItems = failedItems.slice(0, getSectionVisibleCount(group.op.id, "failed"));
    const hasMoreQueued = queuedItems.length > visibleQueuedItems.length;
    const hasMoreCompleted = completedItems.length > visibleCompletedItems.length;
    const hasMoreFailed = failedItems.length > visibleFailedItems.length;
    const failedCount = failedItems.length;
    const hasFailed = failedCount > 0 || group.op.completionStatus === "failed";
    const isCompleted = Boolean(group.op.completedAt);
    const queuedOnly = !isCompleted && activeItems.length === 0 && queuedItems.length > 0;
    const statusPill = buildOperationStatusPill({
      hasFailed,
      isCompleted,
      queuedOnly,
      status: group.op.status,
      completionStatus: group.op.completionStatus,
    });
    const actions = (
      <>
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
            Stop all
          </button>
        )}
      </>
    );
    const details = isGroupExpanded(group.op.id) ? (
      group.items.length === 0 ? (
        <div className="space-y-1 ui-caption text-slate-500 dark:text-slate-400">
          <p>{group.op.completedAt ? "No items copied." : "Preparing copy list..."}</p>
          {group.op.completionStatus === "failed" && group.op.errorMessage && (
            <p className="text-rose-600 dark:text-rose-200">{group.op.errorMessage}</p>
          )}
          <div className="pt-1">
            {renderDetailsTextAction("copy", group.op.id)}
          </div>
        </div>
      ) : (
        <>
          {showActiveSection &&
            activeItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">
                    Copying
                    {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          {showQueuedSection &&
            visibleQueuedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">
                    Queued
                    {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          {showQueuedSection && hasMoreQueued && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={() => showMoreSection(group.op.id, "queued")}
              >
                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
              </button>
              {renderDetailsTextAction("copy", group.op.id)}
            </div>
          )}
          {showCompletedSection &&
            visibleCompletedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">
                    {item.status === "done" && "Done"}
                    {item.status === "cancelled" && "Cancelled"}
                    {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          {showCompletedSection && hasMoreCompleted && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={() => showMoreSection(group.op.id, "completed")}
              >
                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
              </button>
              {renderDetailsTextAction("copy", group.op.id)}
            </div>
          )}
          {showFailedSection &&
            visibleFailedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="ui-caption text-slate-400">
                    Failed
                    {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                  </p>
                  {item.errorMessage && (
                    <p className="ui-caption text-rose-600 dark:text-rose-200">{item.errorMessage}</p>
                  )}
                </div>
              </div>
            ))}
          {showFailedSection && hasMoreFailed && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={() => showMoreSection(group.op.id, "failed")}
              >
                Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
              </button>
              {renderDetailsTextAction("copy", group.op.id)}
            </div>
          )}
          {!((showQueuedSection && hasMoreQueued) || (showCompletedSection && hasMoreCompleted) || (showFailedSection && hasMoreFailed)) && (
            <div className="pt-1">
              {renderDetailsTextAction("copy", group.op.id)}
            </div>
          )}
        </>
      )
    ) : null;

    return (
      <OperationCard
        key={group.op.id}
        title={group.op.label}
        subtitle={group.op.path}
        summary={`${group.counts.copying} active · ${group.counts.queued} queued · ${completedCount} completed · ${failedCount} failed · ${group.op.progress}%`}
        progress={group.op.progress}
        statusPill={statusPill}
        actions={actions}
      >
        {details}
      </OperationCard>
    );
  };

  const renderUploadGroup = (group: UploadOperationGroup) => {
    const activeCount = group.activeItems.length;
    const queuedCount = group.queuedItems.length;
    const completedItems = group.completedItems.filter((item) => item.completionStatus !== "failed");
    const failedItems = group.completedItems.filter((item) => item.completionStatus === "failed");
    const failedCount = failedItems.length;
    const completedCount = completedItems.length;
    const visibleQueuedItems = group.queuedItems.slice(0, getSectionVisibleCount(group.id, "queued"));
    const visibleCompletedItems = completedItems.slice(0, getSectionVisibleCount(group.id, "completed"));
    const visibleFailedItems = failedItems.slice(0, getSectionVisibleCount(group.id, "failed"));
    const hasMoreQueued = group.queuedItems.length > visibleQueuedItems.length;
    const hasMoreCompleted = completedItems.length > visibleCompletedItems.length;
    const hasMoreFailed = failedItems.length > visibleFailedItems.length;
    const hasFailed = failedCount > 0;
    const isCompleted = activeCount === 0 && queuedCount === 0 && group.completedItems.length > 0;
    const queuedOnly = activeCount === 0 && queuedCount > 0;
    const statusPill = buildOperationStatusPill({
      hasFailed,
      isCompleted,
      queuedOnly,
      status: "uploading",
      completionStatus: hasFailed ? "failed" : "done",
    });
    const title = group.kind === "folder" ? `Upload folder ${group.label}` : `Upload ${group.label}`;
    const subtitle = group.totalBytes > 0 ? `${formatBytes(group.totalBytes)} total` : undefined;
    const actions = (
      <>
        <button
          type="button"
          className={operationSecondaryClasses}
          onClick={() => toggleGroupExpanded(group.id)}
        >
          {isGroupExpanded(group.id) ? "Hide files" : "Show files"}
        </button>
        {(activeCount > 0 || queuedCount > 0) && (
          <button type="button" className={operationStopClasses} onClick={() => cancelUploadGroup(group.id)}>
            Stop all
          </button>
        )}
      </>
    );
    const details = isGroupExpanded(group.id) ? (
      <>
        {showActiveSection &&
          group.activeItems.map((op) => (
            <div key={op.id} className="flex items-center justify-between gap-3 ui-caption">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{op.itemLabel ?? op.path}</p>
                <p className="ui-caption text-slate-400">
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
        {showQueuedSection &&
          visibleQueuedItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.itemLabel || item.key}</p>
                <p className="ui-caption text-slate-400">Queued · {formatBytes(item.file.size)}</p>
              </div>
              <button type="button" className={operationStopClasses} onClick={() => removeQueuedUpload(item.id)}>
                Stop
              </button>
            </div>
          ))}
        {showQueuedSection && hasMoreQueued && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={operationSecondaryClasses}
              onClick={() => showMoreSection(group.id, "queued")}
            >
              Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
            </button>
            {renderDetailsTextAction("upload", group.id)}
          </div>
        )}
        {showCompletedSection &&
          visibleCompletedItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                  {item.itemLabel ?? item.path}
                </p>
                <p className="ui-caption text-slate-400">
                  {operationCompletionLabel(item.completionStatus)}
                  {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                </p>
              </div>
            </div>
          ))}
        {showCompletedSection && hasMoreCompleted && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={operationSecondaryClasses}
              onClick={() => showMoreSection(group.id, "completed")}
            >
              Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
            </button>
            {renderDetailsTextAction("upload", group.id)}
          </div>
        )}
        {showFailedSection &&
          visibleFailedItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 ui-caption">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.itemLabel ?? item.path}</p>
                <p className="ui-caption text-slate-400">
                  Failed
                  {item.sizeBytes != null ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                </p>
                {item.errorMessage && (
                  <p className="ui-caption text-rose-600 dark:text-rose-200">{item.errorMessage}</p>
                )}
              </div>
            </div>
          ))}
        {showFailedSection && hasMoreFailed && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={operationSecondaryClasses}
              onClick={() => showMoreSection(group.id, "failed")}
            >
              Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
            </button>
            {renderDetailsTextAction("upload", group.id)}
          </div>
        )}
        {!((showQueuedSection && hasMoreQueued) || (showCompletedSection && hasMoreCompleted) || (showFailedSection && hasMoreFailed)) && (
          <div className="pt-1">
            {renderDetailsTextAction("upload", group.id)}
          </div>
        )}
      </>
    ) : null;

    return (
      <OperationCard
        key={group.id}
        title={title}
        subtitle={subtitle}
        summary={`${activeCount} active · ${queuedCount} queued · ${completedCount} completed · ${failedCount} failed · ${group.progress}%`}
        progress={group.progress}
        statusPill={statusPill}
        actions={actions}
      >
        {details}
      </OperationCard>
    );
  };

  const renderOtherOperation = (op: OperationItem) => {
    const isCompleted = Boolean(op.completedAt);
    const hasFailed = op.completionStatus === "failed";
    const statusPill = buildOperationStatusPill({
      hasFailed,
      isCompleted,
      queuedOnly: false,
      status: op.status,
      completionStatus: op.completionStatus,
    });
    const summary = isCompleted
      ? `${operationCompletionLabel(op.completionStatus)}${op.completedAt ? ` · ${op.completedAt}` : ""}`
      : `${op.progress > 0 ? `${op.progress}%` : "In progress"}`;
    const actions = (
      <>
        {renderDetailsAction("other", op.id)}
        {!isCompleted && op.cancelable && (
          <button type="button" className={operationStopClasses} onClick={() => cancelOperation(op.id)}>
            Stop
          </button>
        )}
      </>
    );
    return (
      <OperationCard
        key={op.id}
        title={op.label}
        subtitle={op.path}
        summary={summary}
        progress={op.progress}
        statusPill={statusPill}
        actions={actions}
      >
        {op.completionStatus === "failed" && op.errorMessage ? (
          <p className="ui-caption text-rose-600 dark:text-rose-200">{op.errorMessage}</p>
        ) : null}
      </OperationCard>
    );
  };

  return (
    <Modal title="Operations overview" onClose={onClose} maxWidthClass="max-w-4xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleActive}
            className={`${filterChipClasses} ui-caption ${showActiveOperations ? filterChipActiveClasses : ""}`}
          >
            Active
            <span className={countBadgeClasses}>{formatBadgeCount(activeOperationsCount)}</span>
          </button>
          <button
            type="button"
            onClick={onToggleQueued}
            className={`${filterChipClasses} ui-caption ${showQueuedOperations ? filterChipActiveClasses : ""}`}
          >
            Queue
            <span className={countBadgeClasses}>{formatBadgeCount(queuedOperationsCount)}</span>
          </button>
          <button
            type="button"
            onClick={onToggleCompleted}
            className={`${filterChipClasses} ui-caption ${showCompletedOperations ? filterChipActiveClasses : ""}`}
          >
            Completed
            <span className={countBadgeClasses}>{formatBadgeCount(completedOperationsCount)}</span>
          </button>
          <button
            type="button"
            onClick={onToggleFailed}
            className={`${filterChipClasses} ui-caption ${showFailedOperations ? failedFilterChipActiveClasses : ""}`}
          >
            Failed
            <span className={failedBadgeClasses}>{formatBadgeCount(failedOperationsCount)}</span>
          </button>
          <button
            type="button"
            onClick={onClearFinishedOperations}
            className={`${operationSecondaryClasses} ui-caption sm:ml-auto`}
            disabled={!hasFinishedOperations}
          >
            Clear completed/failed
          </button>
        </div>
        <div className={operationsPanelHeightClasses}>
          <div className={operationsListAreaClasses}>
            {!hasVisibleOperations ? (
              <div className="flex h-full items-center justify-center ui-caption text-slate-500 dark:text-slate-400">
                No operations to show.
              </div>
            ) : (
              <div>
                {timelineEntries.map((entry) => {
                  if (entry.type === "download") {
                    return <Fragment key={entry.key}>{renderDownloadGroup(entry.group)}</Fragment>;
                  }
                  if (entry.type === "delete") {
                    return <Fragment key={entry.key}>{renderDeleteGroup(entry.group)}</Fragment>;
                  }
                  if (entry.type === "copy") {
                    return <Fragment key={entry.key}>{renderCopyGroup(entry.group)}</Fragment>;
                  }
                  if (entry.type === "upload") {
                    return <Fragment key={entry.key}>{renderUploadGroup(entry.group)}</Fragment>;
                  }
                  return <Fragment key={entry.key}>{renderOtherOperation(entry.op)}</Fragment>;
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

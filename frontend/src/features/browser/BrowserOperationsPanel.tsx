/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Fragment, useMemo } from "react";
import { cx } from "../../components/ui/styles";
import { formatBytes } from "../../utils/format";
import {
  countBadgeClasses,
  operationSecondaryClasses,
  operationStopClasses,
} from "./browserConstants";
import { ChevronDownIcon, DownloadIcon, InfoIcon, XIcon } from "./browserIcons";
import {
  buildOperationTimelineEntries,
  type BrowserOperationTimelineEntry,
} from "./browserOperationGroups";
import { buildOperationStatusPill, operationCompletionLabel } from "./browserOperationStatus";
import { formatBadgeCount } from "./browserUtils";
import type {
  CopyOperationGroup,
  DeleteOperationGroup,
  DownloadOperationGroup,
  OperationItem,
  UploadOperationGroup,
} from "./browserTypes";

type BrowserOperationsPanelProps = {
  open: boolean;
  totalOperationsCount: number;
  activeOperationsCount: number;
  queuedOperationsCount: number;
  completedOperationsCount: number;
  failedOperationsCount: number;
  downloadGroups: DownloadOperationGroup[];
  deleteGroups: DeleteOperationGroup[];
  copyGroups: CopyOperationGroup[];
  uploadGroups: UploadOperationGroup[];
  otherOperations: OperationItem[];
  operationSortIndexById: Record<string, number>;
  uploadGroupSortIndexById: Record<string, number>;
  operationSortFallback: number;
  cancelOperation: (operationId: string) => void;
  cancelUploadGroup: (groupId: string) => void;
  hasFinishedOperations: boolean;
  canDismiss: boolean;
  onClearFinishedOperations: () => void;
  onDismiss: () => void;
  onOpenDetails: () => void;
  onToggleOpen: () => void;
};

type OperationRowProps = {
  title: string;
  subtitle?: string;
  summary: string;
  progress: number;
  statusLabel: string;
  statusClasses: string;
  actionLabel?: "Stop" | "Stop all";
  onAction?: () => void;
};

function OperationRow({
  title,
  subtitle,
  summary,
  progress,
  statusLabel,
  statusClasses: rowStatusClasses,
  actionLabel,
  onAction,
}: OperationRowProps) {
  return (
    <div className="py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate ui-caption font-semibold text-[var(--ui-text)]">{title}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 ui-caption font-semibold ${rowStatusClasses}`}>
              {statusLabel}
            </span>
          </div>
          {subtitle && <p className="mt-0.5 truncate ui-caption text-[var(--ui-text-muted)]">{subtitle}</p>}
          <p className="mt-0.5 ui-caption tabular-nums text-[var(--ui-text-muted)]">{summary}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--ui-surface-muted)]">
            <div className="h-full bg-primary-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
        {actionLabel && onAction ? (
          <button type="button" className={operationStopClasses} onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function BrowserOperationsPanel({
  open,
  totalOperationsCount,
  activeOperationsCount,
  queuedOperationsCount,
  completedOperationsCount,
  failedOperationsCount,
  downloadGroups,
  deleteGroups,
  copyGroups,
  uploadGroups,
  otherOperations,
  operationSortIndexById,
  uploadGroupSortIndexById,
  operationSortFallback,
  cancelOperation,
  cancelUploadGroup,
  hasFinishedOperations,
  canDismiss,
  onClearFinishedOperations,
  onDismiss,
  onOpenDetails,
  onToggleOpen,
}: BrowserOperationsPanelProps) {
  const pendingOperationsCount = activeOperationsCount + queuedOperationsCount;
  const dominantStatus =
    failedOperationsCount > 0
      ? "Failed"
      : activeOperationsCount > 0
        ? "In progress"
        : queuedOperationsCount > 0
          ? "Queued"
          : completedOperationsCount > 0
            ? "Completed"
            : "Idle";
  const dominantStatusClasses =
    failedOperationsCount > 0
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-100"
      : activeOperationsCount > 0
        ? "border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-500/35 dark:bg-primary-500/15 dark:text-primary-100"
        : queuedOperationsCount > 0
          ? "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-100";

  const timelineEntries = useMemo(
    () =>
      buildOperationTimelineEntries({
        downloadGroups,
        deleteGroups,
        copyGroups,
        uploadGroups,
        otherOperations,
        operationSortIndexById,
        uploadGroupSortIndexById,
        operationSortFallback,
      }),
    [
    copyGroups,
    deleteGroups,
    downloadGroups,
    operationSortFallback,
    operationSortIndexById,
    otherOperations,
    uploadGroupSortIndexById,
    uploadGroups,
    ],
  );

  const overallProgress = useMemo(() => {
    if (pendingOperationsCount === 0 && totalOperationsCount > 0) return 100;
    const progressValues = timelineEntries
      .map((entry) => {
        if (entry.type === "upload") return entry.group.progress;
        if (entry.type === "other") return entry.op.progress;
        return entry.group.op.progress;
      })
      .filter((value) => Number.isFinite(value));
    if (progressValues.length === 0) return pendingOperationsCount > 0 ? 0 : 100;
    const average = progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length;
    return Math.max(0, Math.min(100, Math.round(average)));
  }, [pendingOperationsCount, timelineEntries, totalOperationsCount]);

  const renderEntry = (entry: BrowserOperationTimelineEntry) => {
    if (entry.type === "upload") {
      const { group } = entry;
      const activeCount = group.activeItems.length;
      const queuedCount = group.queuedItems.length;
      const failedCount = group.completedItems.filter((item) => item.completionStatus === "failed").length;
      const completedCount = group.completedItems.length - failedCount;
      const isCompleted = activeCount === 0 && queuedCount === 0 && group.completedItems.length > 0;
      const status = buildOperationStatusPill({
        hasFailed: failedCount > 0,
        isCompleted,
        queuedOnly: activeCount === 0 && queuedCount > 0,
        status: "uploading",
        completionStatus: failedCount > 0 ? "failed" : "done",
      });
      return (
        <OperationRow
          title={group.kind === "folder" ? `Upload folder ${group.label}` : `Upload ${group.label}`}
          subtitle={group.totalBytes > 0 ? `${formatBytes(group.totalBytes)} total` : undefined}
          summary={`${activeCount} active · ${queuedCount} queued · ${completedCount} completed · ${failedCount} failed`}
          progress={group.progress}
          statusLabel={status.label}
          statusClasses={status.classes}
          actionLabel={activeCount > 0 || queuedCount > 0 ? "Stop all" : undefined}
          onAction={activeCount > 0 || queuedCount > 0 ? () => cancelUploadGroup(group.id) : undefined}
        />
      );
    }

    if (entry.type === "other") {
      const { op } = entry;
      const isCompleted = Boolean(op.completedAt);
      const status = buildOperationStatusPill({
        hasFailed: op.completionStatus === "failed",
        isCompleted,
        queuedOnly: false,
        status: op.status,
        completionStatus: op.completionStatus,
      });
      return (
        <OperationRow
          title={op.label}
          subtitle={op.path}
          summary={isCompleted ? operationCompletionLabel(op.completionStatus) : `${op.progress}%`}
          progress={op.progress}
          statusLabel={status.label}
          statusClasses={status.classes}
          actionLabel={!isCompleted && op.cancelable ? "Stop" : undefined}
          onAction={!isCompleted && op.cancelable ? () => cancelOperation(op.id) : undefined}
        />
      );
    }

    const activeCount =
      entry.type === "download"
        ? entry.group.counts.downloading
        : entry.type === "delete"
          ? entry.group.counts.deleting
          : entry.group.counts.copying;
    const { group } = entry;
    const queuedCount = group.counts.queued;
    const completedCount = group.items.filter((item) => item.status === "done" || item.status === "cancelled").length;
    const failedCount = group.items.filter((item) => item.status === "failed").length;
    const isCompleted = Boolean(group.op.completedAt);
    const status = buildOperationStatusPill({
      hasFailed: failedCount > 0 || group.op.completionStatus === "failed",
      isCompleted,
      queuedOnly: !isCompleted && activeCount === 0 && queuedCount > 0,
      status: group.op.status,
      completionStatus: group.op.completionStatus,
    });
    return (
      <OperationRow
        title={group.op.label}
        subtitle={group.op.path}
        summary={`${activeCount} active · ${queuedCount} queued · ${completedCount} completed · ${failedCount} failed`}
        progress={group.op.progress}
        statusLabel={status.label}
        statusClasses={status.classes}
        actionLabel={group.op.cancelable && !group.op.completedAt ? (entry.type === "download" ? "Stop" : "Stop all") : undefined}
        onAction={group.op.cancelable && !group.op.completedAt ? () => cancelOperation(group.op.id) : undefined}
      />
    );
  };

  return (
    <section
      role="complementary"
      aria-label="Operations"
      className="fixed inset-x-3 bottom-4 z-[46] sm:left-auto sm:right-4 sm:w-[420px]"
    >
      <div className="overflow-hidden rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--shell-menu-shadow)]">
        <div className="flex items-stretch bg-[var(--ui-surface)]">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
            onClick={onToggleOpen}
            aria-expanded={open}
            aria-label={open ? "Collapse operations" : "Expand operations"}
            title={open ? "Collapse operations" : "Expand operations"}
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--ui-surface-muted)] text-[var(--ui-text-muted)]">
              <DownloadIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate ui-body font-semibold">Operations</span>
                <span className={countBadgeClasses}>{formatBadgeCount(totalOperationsCount)}</span>
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-2">
                <span className={`shrink-0 rounded-md border px-1.5 py-0.5 ui-caption font-semibold ${dominantStatusClasses}`}>
                  {dominantStatus}
                </span>
                <span className="truncate ui-caption text-[var(--ui-text-muted)]">
                  {pendingOperationsCount > 0
                    ? `${pendingOperationsCount} active or queued`
                    : hasFinishedOperations
                      ? "Finished operations"
                      : "No operations"}
                </span>
              </span>
            </span>
            <ChevronDownIcon className={cx("h-4 w-4 shrink-0 text-[var(--ui-text-muted)] transition", open ? "rotate-180" : "")} />
          </button>
          <div className="flex shrink-0 items-stretch">
            {canDismiss ? (
              <button
                type="button"
                className="flex w-9 items-center justify-center text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                onClick={onDismiss}
                aria-label="Dismiss operations panel"
                title="Dismiss operations panel"
              >
                <XIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="h-1 bg-[var(--ui-surface-muted)]">
          <div
            className={cx("h-full transition-all", failedOperationsCount > 0 ? "bg-rose-500" : "bg-primary-500")}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
        {open ? (
          <div className="max-h-[65dvh] overflow-y-auto px-3 py-1 sm:max-h-[min(52vh,360px)]">
            {timelineEntries.length === 0 ? (
              <div className="py-6 text-center ui-caption text-[var(--ui-text-muted)]">No operations to show.</div>
            ) : (
              <div className="divide-y divide-[color:var(--ui-border-soft)]">
                {timelineEntries.map((entry) => (
                  <Fragment key={entry.key}>{renderEntry(entry)}</Fragment>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-[color:var(--ui-border-soft)] py-2">
              <button
                type="button"
                className={`${operationSecondaryClasses} gap-1.5 ui-caption`}
                onClick={onOpenDetails}
                aria-label="Operations overview"
                title="Operations overview"
              >
                <InfoIcon className="h-3.5 w-3.5" />
                <span>Overview</span>
              </button>
              {hasFinishedOperations ? (
                <button type="button" className={`${operationSecondaryClasses} ui-caption`} onClick={onClearFinishedOperations}>
                  Clear completed/failed
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

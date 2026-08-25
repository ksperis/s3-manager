/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import { formatBytes } from "../../utils/format";
import {
  DEFAULT_QUEUED_VISIBLE_COUNT,
  operationSecondaryClasses,
  operationStopClasses,
} from "./browserConstants";
import { buildOperationStatusPill } from "./browserOperationStatus";
import type {
  OperationDetailsKind,
  OperationItem,
} from "./browserTypes";

type BrowserOperationSection = "queued" | "completed" | "failed";

type BrowserOperationCardProps = {
  title: string;
  subtitle?: string;
  summary?: string;
  progress?: number;
  statusPill?: { label: string; classes: string };
  actions?: ReactNode;
  children?: ReactNode;
};

export function BrowserOperationCard({
  title,
  subtitle,
  summary,
  progress,
  statusPill,
  actions,
  children,
}: BrowserOperationCardProps) {
  return (
    <div className="border-b border-[color:var(--ui-border-soft)] py-3 last:border-b-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="ui-caption font-semibold text-[var(--ui-text)]">
            {title}
          </p>
          {subtitle && (
            <p className="ui-caption text-[var(--ui-text-muted)]">
              {subtitle}
            </p>
          )}
          {summary && (
            <p className="ui-caption tabular-nums text-[var(--ui-text-muted)]">
              {summary}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-2 sm:shrink-0 sm:flex-nowrap sm:justify-end">
          {statusPill && (
            <span
              className={`ui-caption shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${statusPill.classes}`}
            >
              {statusPill.label}
            </span>
          )}
          {actions}
        </div>
      </div>
      {typeof progress === "number" && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--ui-surface-muted)]">
          <div
            className="h-full bg-primary-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {children != null && (
        <div className="mt-2 space-y-1.5">{children}</div>
      )}
    </div>
  );
}

type TransferOperationKind = Extract<
  OperationDetailsKind,
  "download" | "delete" | "copy"
>;

type TransferDetailItem = {
  id: string;
  label: string;
  status: string;
  sizeBytes?: number;
  errorMessage?: string;
};

type TransferOperationGroup = {
  op: OperationItem;
  items: readonly TransferDetailItem[];
};

type TransferOperationConfig = {
  activeStatus: "downloading" | "deleting" | "copying";
  activeLabel: "Downloading" | "Deleting" | "Copying";
  emptyCompletedLabel: string;
  emptyPendingLabel: string;
  showSize: boolean;
  stopLabel: "Stop" | "Stop all";
};

const transferOperationConfig = {
  download: {
    activeStatus: "downloading",
    activeLabel: "Downloading",
    emptyCompletedLabel: "No files found.",
    emptyPendingLabel: "Preparing download list...",
    showSize: true,
    stopLabel: "Stop",
  },
  delete: {
    activeStatus: "deleting",
    activeLabel: "Deleting",
    emptyCompletedLabel: "No items to delete.",
    emptyPendingLabel: "Preparing delete list...",
    showSize: false,
    stopLabel: "Stop all",
  },
  copy: {
    activeStatus: "copying",
    activeLabel: "Copying",
    emptyCompletedLabel: "No items copied.",
    emptyPendingLabel: "Preparing copy list...",
    showSize: true,
    stopLabel: "Stop all",
  },
} satisfies Record<TransferOperationKind, TransferOperationConfig>;

type BrowserTransferOperationGroupCardProps = {
  kind: TransferOperationKind;
  group: TransferOperationGroup;
  expanded: boolean;
  sections: {
    active: boolean;
    queued: boolean;
    completed: boolean;
    failed: boolean;
  };
  getSectionVisibleCount: (
    groupId: string,
    section: BrowserOperationSection,
  ) => number;
  onToggleExpanded: (groupId: string) => void;
  onShowMore: (groupId: string, section: BrowserOperationSection) => void;
  onCancel: (operationId: string) => void;
  onDownloadDetails: (
    kind: OperationDetailsKind,
    operationId: string,
  ) => void;
};

function DetailItemRow({
  item,
  label,
  showSize,
  showError = false,
}: {
  item: TransferDetailItem;
  label: string;
  showSize: boolean;
  showError?: boolean;
}) {
  return (
    <div className="ui-caption flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
          {item.label}
        </p>
        <p className="ui-caption text-slate-400">
          {label}
          {showSize && item.sizeBytes != null
            ? ` · ${formatBytes(item.sizeBytes)}`
            : ""}
        </p>
        {showError && item.errorMessage && (
          <p className="ui-caption text-rose-600 dark:text-rose-200">
            {item.errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

export function BrowserTransferOperationGroupCard({
  kind,
  group,
  expanded,
  sections,
  getSectionVisibleCount,
  onToggleExpanded,
  onShowMore,
  onCancel,
  onDownloadDetails,
}: BrowserTransferOperationGroupCardProps) {
  const config = transferOperationConfig[kind];
  const activeItems = group.items.filter(
    (item) => item.status === config.activeStatus,
  );
  const queuedItems = group.items.filter((item) => item.status === "queued");
  const completedItems = group.items.filter(
    (item) => item.status === "done" || item.status === "cancelled",
  );
  const failedItems = group.items.filter((item) => item.status === "failed");
  const visibleQueuedItems = queuedItems.slice(
    0,
    getSectionVisibleCount(group.op.id, "queued"),
  );
  const visibleCompletedItems = completedItems.slice(
    0,
    getSectionVisibleCount(group.op.id, "completed"),
  );
  const visibleFailedItems = failedItems.slice(
    0,
    getSectionVisibleCount(group.op.id, "failed"),
  );
  const hasMoreQueued = queuedItems.length > visibleQueuedItems.length;
  const hasMoreCompleted =
    completedItems.length > visibleCompletedItems.length;
  const hasMoreFailed = failedItems.length > visibleFailedItems.length;
  const isCompleted = Boolean(group.op.completedAt);
  const statusPill = buildOperationStatusPill({
    hasFailed:
      failedItems.length > 0 || group.op.completionStatus === "failed",
    isCompleted,
    queuedOnly:
      !isCompleted && activeItems.length === 0 && queuedItems.length > 0,
    status: group.op.status,
    completionStatus: group.op.completionStatus,
  });
  const downloadDetails = () => onDownloadDetails(kind, group.op.id);
  const renderShowMore = (section: BrowserOperationSection) => (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={operationSecondaryClasses}
        onClick={() => onShowMore(group.op.id, section)}
      >
        Show next {DEFAULT_QUEUED_VISIBLE_COUNT}
      </button>
      <button
        type="button"
        className={operationSecondaryClasses}
        onClick={downloadDetails}
      >
        Download details (JSON)
      </button>
    </div>
  );
  const hasVisiblePagination =
    (sections.queued && hasMoreQueued) ||
    (sections.completed && hasMoreCompleted) ||
    (sections.failed && hasMoreFailed);

  return (
    <BrowserOperationCard
      title={group.op.label}
      subtitle={group.op.path}
      summary={`${activeItems.length} active · ${queuedItems.length} queued · ${completedItems.length} completed · ${failedItems.length} failed · ${group.op.progress}%`}
      progress={group.op.progress}
      statusPill={statusPill}
      actions={
        <>
          <button
            type="button"
            className={operationSecondaryClasses}
            onClick={() => onToggleExpanded(group.op.id)}
          >
            {expanded ? "Hide files" : "Show files"}
          </button>
          {group.op.cancelable && !group.op.completedAt && (
            <button
              type="button"
              className={operationStopClasses}
              onClick={() => onCancel(group.op.id)}
            >
              {config.stopLabel}
            </button>
          )}
        </>
      }
    >
      {expanded &&
        (group.items.length === 0 ? (
          <div className="ui-caption space-y-1 text-slate-500 dark:text-slate-400">
            <p>
              {group.op.completedAt
                ? config.emptyCompletedLabel
                : config.emptyPendingLabel}
            </p>
            {group.op.completionStatus === "failed" &&
              group.op.errorMessage && (
                <p className="text-rose-600 dark:text-rose-200">
                  {group.op.errorMessage}
                </p>
              )}
            <div className="pt-1">
              <button
                type="button"
                className={operationSecondaryClasses}
                onClick={downloadDetails}
              >
                Download details (JSON)
              </button>
            </div>
          </div>
        ) : (
          <>
            {sections.active &&
              activeItems.map((item) => (
                <DetailItemRow
                  key={item.id}
                  item={item}
                  label={config.activeLabel}
                  showSize={config.showSize}
                />
              ))}
            {sections.queued &&
              visibleQueuedItems.map((item) => (
                <DetailItemRow
                  key={item.id}
                  item={item}
                  label="Queued"
                  showSize={config.showSize}
                />
              ))}
            {sections.queued &&
              hasMoreQueued &&
              renderShowMore("queued")}
            {sections.completed &&
              visibleCompletedItems.map((item) => (
                <DetailItemRow
                  key={item.id}
                  item={item}
                  label={item.status === "cancelled" ? "Cancelled" : "Done"}
                  showSize={config.showSize}
                />
              ))}
            {sections.completed &&
              hasMoreCompleted &&
              renderShowMore("completed")}
            {sections.failed &&
              visibleFailedItems.map((item) => (
                <DetailItemRow
                  key={item.id}
                  item={item}
                  label="Failed"
                  showSize={config.showSize}
                  showError
                />
              ))}
            {sections.failed &&
              hasMoreFailed &&
              renderShowMore("failed")}
            {!hasVisiblePagination && (
              <div className="pt-1">
                <button
                  type="button"
                  className={operationSecondaryClasses}
                  onClick={downloadDetails}
                >
                  Download details (JSON)
                </button>
              </div>
            )}
          </>
        ))}
    </BrowserOperationCard>
  );
}

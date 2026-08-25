/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Fragment, useMemo } from "react";
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
import {
  BrowserOperationCard,
  BrowserTransferOperationGroupCard,
} from "./BrowserOperationCards";
import { buildOperationTimelineEntries } from "./browserOperationGroups";
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

  const timelineEntries = useMemo(
    () =>
      buildOperationTimelineEntries({
        downloadGroups: visibleDownloadGroups,
        deleteGroups: visibleDeleteGroups,
        copyGroups: visibleCopyGroups,
        uploadGroups: visibleUploadGroups,
        otherOperations: visibleOtherOperations,
        operationSortIndexById,
        uploadGroupSortIndexById,
        operationSortFallback,
      }),
    [
      operationSortFallback,
      operationSortIndexById,
      uploadGroupSortIndexById,
      visibleCopyGroups,
      visibleDeleteGroups,
      visibleDownloadGroups,
      visibleOtherOperations,
      visibleUploadGroups,
    ],
  );
  const operationSections = {
    active: showActiveSection,
    queued: showQueuedSection,
    completed: showCompletedSection,
    failed: showFailedSection,
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
      <BrowserOperationCard
        key={group.id}
        title={title}
        subtitle={subtitle}
        summary={`${activeCount} active · ${queuedCount} queued · ${completedCount} completed · ${failedCount} failed · ${group.progress}%`}
        progress={group.progress}
        statusPill={statusPill}
        actions={actions}
      >
        {details}
      </BrowserOperationCard>
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
      <BrowserOperationCard
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
      </BrowserOperationCard>
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
                  if (
                    entry.type === "download" ||
                    entry.type === "delete" ||
                    entry.type === "copy"
                  ) {
                    return (
                      <BrowserTransferOperationGroupCard
                        key={entry.key}
                        kind={entry.type}
                        group={entry.group}
                        expanded={isGroupExpanded(entry.group.op.id)}
                        sections={operationSections}
                        getSectionVisibleCount={getSectionVisibleCount}
                        onToggleExpanded={toggleGroupExpanded}
                        onShowMore={showMoreSection}
                        onCancel={cancelOperation}
                        onDownloadDetails={onDownloadOperationDetails}
                      />
                    );
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

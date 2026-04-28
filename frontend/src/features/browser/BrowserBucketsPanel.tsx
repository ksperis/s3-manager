/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { RefObject } from "react";
import {
  toolbarCompactButtonClasses,
  toolbarCompactInputClasses,
} from "../../components/toolbarControlClasses";
import { cx, uiCardClass, uiCardMutedClass } from "../../components/ui/styles";
import type { BrowserBucket } from "../../api/browser";
import {
  BucketIcon,
  FolderIcon,
  RefreshIcon,
  SearchIcon,
} from "./browserIcons";
import {
  treeItemActiveClasses,
  treeItemBaseClasses,
  treeItemInactiveClasses,
  treeToggleButtonClasses,
} from "./browserConstants";
import type { TreeNode } from "./browserTypes";
import type { BucketAccessEntry, BucketAccessStatus } from "./browserBucketsPanelHelpers";

type BucketRow = {
  bucket: BrowserBucket;
  access: BucketAccessEntry;
};

type BrowserBucketsPanelProps = {
  hasS3AccountContext: boolean;
  currentBucket: BrowserBucket | null;
  activePrefix: string;
  currentBucketAccess: BucketAccessEntry;
  treeRootNode: TreeNode | null;
  bucketFilter: string;
  onBucketFilterChange: (value: string) => void;
  otherBuckets: BucketRow[];
  loadingBuckets: boolean;
  bucketError: string | null;
  onRetryBuckets: () => void;
  bucketManagementEnabled: boolean;
  onCreateBucket: () => void;
  onSelectBucket: (bucketName: string) => void;
  onSelectPrefix: (prefix: string) => void;
  onToggleTreeNode: (node: TreeNode) => void;
  canLoadMore: boolean;
  onLoadMore: () => void;
  bucketMenuLoadingMore: boolean;
  bucketMenuTotal: number;
  bucketTotalCount: number;
  panelViewportRef: RefObject<HTMLDivElement | null>;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
};

const bucketSectionTitleClasses = "ui-caption font-semibold text-slate-500 dark:text-slate-400";
const bucketFilterInputClasses =
  cx(toolbarCompactInputClasses, "w-full py-2 font-medium");
const bucketRowBaseClasses =
  "flex w-full min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left ui-caption transition";
const bucketRowIdleClasses =
  "border-slate-200 bg-white text-slate-700 shadow-sm hover:border-primary/40 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-primary-500/40 dark:hover:bg-slate-800";
const bucketRowUnavailableClasses =
  "border-slate-200 bg-slate-50 text-slate-400 shadow-sm hover:border-amber-200 hover:bg-amber-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-500 dark:hover:border-amber-500/40 dark:hover:bg-amber-500/10";
const bucketSubtleCardClasses =
  cx(uiCardMutedClass, "rounded-xl p-3 shadow-none");
const panelButtonClasses = `${toolbarCompactButtonClasses} inline-flex items-center whitespace-nowrap`;

const bucketAccessBadgeClasses: Record<BucketAccessStatus, string> = {
  unknown: "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  checking:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/30 dark:text-sky-100",
  available:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-900/30 dark:text-emerald-100",
  unavailable:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/30 dark:text-amber-100",
};
const bucketAccessIndicatorClasses: Record<BucketAccessStatus, string> = {
  unknown: bucketAccessBadgeClasses.unknown,
  checking: bucketAccessBadgeClasses.checking,
  available:
    "border-emerald-200/70 bg-emerald-200/60 text-emerald-600/70 dark:border-emerald-400/40 dark:bg-emerald-400/25 dark:text-emerald-200/90",
  unavailable: bucketAccessBadgeClasses.unavailable,
};

const bucketAccessLabel: Record<BucketAccessStatus, string> = {
  unknown: "Idle",
  checking: "Checking",
  available: "Ready",
  unavailable: "No list access",
};

type BucketAccessStatusProps = {
  status: BucketAccessStatus;
  variant?: "badge" | "compact";
};

function BucketAccessStatus({
  status,
  variant = "badge",
}: BucketAccessStatusProps) {
  if (variant === "compact" && status === "available") {
    return (
      <span
        className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full border ${bucketAccessIndicatorClasses[status]}`}
        aria-label={bucketAccessLabel[status]}
        title={bucketAccessLabel[status]}
      />
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${bucketAccessBadgeClasses[status]}`}
    >
      {status === "checking" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}
      <span>{bucketAccessLabel[status]}</span>
    </span>
  );
}

function renderTreeNodes(
  nodes: TreeNode[],
  activePrefix: string,
  depth: number,
  onSelectPrefix: (prefix: string) => void,
  onToggleTreeNode: (node: TreeNode) => void
): JSX.Element {
  return (
    <ul className="w-full min-w-0 space-y-1">
      {nodes.map((node) => {
        const isActive = activePrefix === node.prefix;
        const canToggle = node.isLoaded ? node.children.length > 0 : true;
        const labelClasses = `${treeItemBaseClasses} min-h-8 rounded-md px-2 py-1 ${isActive ? treeItemActiveClasses : treeItemInactiveClasses}`;
        return (
          <li key={node.id}>
            <div className="flex min-w-0 items-start gap-1" style={{ paddingLeft: depth * 12 }}>
              <button
                type="button"
                className={`${treeToggleButtonClasses} mt-1 h-5 w-5 rounded-md`}
                onClick={() => onToggleTreeNode(node)}
                disabled={!canToggle}
                aria-label={node.isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                title={node.isExpanded ? "Collapse" : "Expand"}
              >
                {canToggle ? (node.isExpanded ? "-" : "+") : ""}
              </button>
              <button
                type="button"
                className={labelClasses}
                onClick={() => onSelectPrefix(node.prefix)}
                title={node.name}
              >
                <FolderIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            </div>
            {node.isExpanded && (node.isLoading || node.children.length > 0) && (
              <div className="mt-1">
                {node.isLoading ? (
                  <div className="pl-8 ui-caption text-slate-400 dark:text-slate-500">Loading folders...</div>
                ) : (
                  renderTreeNodes(node.children, activePrefix, depth + 1, onSelectPrefix, onToggleTreeNode)
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function BrowserBucketsPanel({
  hasS3AccountContext,
  currentBucket,
  activePrefix,
  currentBucketAccess,
  treeRootNode,
  bucketFilter,
  onBucketFilterChange,
  otherBuckets,
  loadingBuckets,
  bucketError,
  onRetryBuckets,
  bucketManagementEnabled,
  onCreateBucket,
  onSelectBucket,
  onSelectPrefix,
  onToggleTreeNode,
  canLoadMore,
  onLoadMore,
  bucketMenuLoadingMore,
  bucketMenuTotal,
  bucketTotalCount,
  panelViewportRef,
  loadMoreSentinelRef,
}: BrowserBucketsPanelProps) {
  const currentBucketUnavailable = currentBucketAccess.status === "unavailable";
  const currentBucketChildren = treeRootNode?.children ?? [];
  const currentBucketLoading = Boolean(currentBucket && treeRootNode?.isLoading);
  const currentBucketHasFolders = currentBucketChildren.length > 0;
  const showingFilteredBuckets = bucketFilter.trim().length > 0;
  const currentBucketMatchesFilter =
    !currentBucket ||
    bucketFilter.trim().length === 0 ||
    currentBucket.name.toLowerCase().includes(bucketFilter.trim().toLowerCase());

  return (
    <div
      className={cx(
        uiCardClass,
        "flex h-full min-h-0 min-w-0 flex-col rounded-xl bg-gradient-to-r from-white via-white to-slate-50/80 p-3 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/70",
      )}
    >
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={bucketSectionTitleClasses}>Buckets</p>
          </div>
          <div className="flex items-center gap-1">
            {bucketManagementEnabled && (
              <button type="button" className={panelButtonClasses} onClick={onCreateBucket}>
                + Bucket
              </button>
            )}
            <button type="button" className={panelButtonClasses} onClick={onRetryBuckets} disabled={loadingBuckets}>
              <RefreshIcon className="h-3.5 w-3.5" />
              {loadingBuckets ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </div>
        <label className="mt-3 block">
          <span className="sr-only">Filter buckets</span>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={bucketFilter}
              onChange={(event) => onBucketFilterChange(event.target.value)}
              placeholder="Filter buckets"
              className={`${bucketFilterInputClasses} pl-9`}
              spellCheck={false}
            />
          </div>
        </label>
      </div>

      <div
        ref={panelViewportRef}
        className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <div className="space-y-3">
          {currentBucketMatchesFilter && (
            <section className={bucketSubtleCardClasses} aria-label="Current bucket">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={bucketSectionTitleClasses}>Current bucket</p>
                  {currentBucket ? (
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      <BucketIcon className="h-4 w-4 shrink-0 text-primary-700 dark:text-primary-200" />
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{currentBucket.name}</p>
                    </div>
                  ) : (
                    <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">Select a bucket to browse folders.</p>
                  )}
                </div>
                {currentBucket && (
                  <div
                    title={
                      currentBucketUnavailable
                        ? "Listing not allowed with current credentials."
                        : undefined
                    }
                  >
                    <BucketAccessStatus status={currentBucketAccess.status} variant="compact" />
                  </div>
                )}
              </div>

              {!hasS3AccountContext ? (
                <div className="mt-3 min-h-[6rem]">
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Select a context to load buckets.</p>
                </div>
              ) : currentBucket ? (
                <div className="mt-3 min-h-[6rem]">
                  {currentBucketUnavailable ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 ui-caption text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/30 dark:text-amber-100">
                      <p className="font-semibold">Folder tree unavailable with current credentials.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {currentBucketLoading ? (
                        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 ui-caption text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          Loading folders...
                        </div>
                      ) : currentBucketHasFolders ? (
                        renderTreeNodes(currentBucketChildren, activePrefix, 0, onSelectPrefix, onToggleTreeNode)
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 ui-caption text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          No folders found under this prefix.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          )}

          <section className={bucketSubtleCardClasses} aria-label="Other buckets">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={bucketSectionTitleClasses}>Other buckets</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {showingFilteredBuckets ? `${bucketMenuTotal.toLocaleString()} matching buckets` : `${bucketTotalCount.toLocaleString()} buckets in this context`}
                </p>
              </div>
            </div>

            <div className="mt-3">
              {!hasS3AccountContext ? (
                <p className="ui-caption text-slate-500 dark:text-slate-400">Select a context to list buckets.</p>
              ) : loadingBuckets && otherBuckets.length === 0 ? (
                <p className="ui-caption text-slate-500 dark:text-slate-400">Loading buckets...</p>
              ) : bucketError && bucketTotalCount === 0 && otherBuckets.length === 0 ? (
                <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/80 p-3 dark:border-rose-500/30 dark:bg-rose-900/20">
                  <p className="ui-caption font-semibold text-rose-700 dark:text-rose-100">{bucketError}</p>
                  <button type="button" className={panelButtonClasses} onClick={onRetryBuckets}>
                    Retry
                  </button>
                </div>
              ) : otherBuckets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 ui-caption text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {showingFilteredBuckets ? "No other buckets match this filter." : "No other buckets available."}
                </div>
              ) : (
                <div className="space-y-2">
                  {otherBuckets.map(({ bucket, access }) => {
                    const unavailable = access.status === "unavailable";
                    return (
                      <button
                        key={bucket.name}
                        type="button"
                        data-bucket-panel-name={bucket.name}
                        className={`${bucketRowBaseClasses} ${unavailable ? bucketRowUnavailableClasses : bucketRowIdleClasses}`}
                        onClick={() => onSelectBucket(bucket.name)}
                        title={
                          unavailable
                            ? "Listing not allowed with current credentials."
                            : bucket.name
                        }
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <BucketIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate font-semibold">{bucket.name}</span>
                        </span>
                        {access.status !== "unknown" && <BucketAccessStatus status={access.status} variant="compact" />}
                      </button>
                    );
                  })}
                  <div ref={loadMoreSentinelRef} className="h-1" aria-hidden="true" />
                  {bucketMenuLoadingMore && (
                    <p className="px-1 ui-caption text-slate-400 dark:text-slate-500">Loading more buckets...</p>
                  )}
                </div>
              )}
            </div>
          </section>

          {canLoadMore && (
            <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
              <button type="button" className={panelButtonClasses} onClick={onLoadMore} disabled={bucketMenuLoadingMore}>
                {bucketMenuLoadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

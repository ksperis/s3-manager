/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { RefObject } from "react";
import { SIDEBAR_COMPACT_WIDTH, SIDEBAR_DEFAULT_WIDTH } from "../../components/sidebarSizing";
import {
  toolbarCompactButtonClasses,
  toolbarCompactInputClasses,
} from "../../components/toolbarControlClasses";
import { cx, uiCardMutedClass } from "../../components/ui/styles";
import type { BrowserBucket, BrowserUsageSummary } from "../../api/browser";
import { formatBytes } from "../../utils/format";
import {
  BucketCollectionIcon,
  BucketIcon,
  RefreshIcon,
  SearchIcon,
  SlidersIcon,
} from "./browserIcons";
import type { BucketAccessEntry, BucketAccessStatus } from "./browserBucketsPanelHelpers";

export type BrowserWorkspaceSidebarBucketRow = {
  bucket: BrowserBucket;
  access: BucketAccessEntry;
};

type BrowserWorkspaceSidebarProps = {
  collapsed: boolean;
  isPortalContext: boolean;
  rows: BrowserWorkspaceSidebarBucketRow[];
  activeBucketName: string;
  bucketFilter: string;
  loadingBuckets: boolean;
  bucketError: string | null;
  bucketManagementEnabled: boolean;
  canLoadMore: boolean;
  bucketMenuLoadingMore: boolean;
  bucketMenuTotal: number;
  bucketTotalCount: number;
  usageSummary: BrowserUsageSummary | null;
  usageLoading: boolean;
  usageError: string | null;
  panelViewportRef: RefObject<HTMLDivElement | null>;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  onToggleCollapsed: () => void;
  onBucketFilterChange: (value: string) => void;
  onRetryBuckets: () => void;
  onCreateBucket: () => void;
  onSelectBucket: (bucketName: string) => void;
  onLoadMore: () => void;
  onOpenUsageMetrics?: () => void;
};

const accessIndicatorClasses: Record<BucketAccessStatus, string> = {
  unknown: "border-slate-300 bg-slate-200 text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300",
  checking:
    "border-sky-300 bg-sky-200 text-sky-700 dark:border-sky-400/50 dark:bg-sky-500/30 dark:text-sky-100",
  available:
    "border-emerald-300 bg-emerald-200 text-emerald-700 dark:border-emerald-400/50 dark:bg-emerald-500/30 dark:text-emerald-100",
  unavailable:
    "border-amber-300 bg-amber-200 text-amber-800 dark:border-amber-400/50 dark:bg-amber-500/30 dark:text-amber-100",
};

const accessLabel: Record<BucketAccessStatus, string> = {
  unknown: "Idle",
  checking: "Checking",
  available: "Ready",
  unavailable: "No list access",
};
const unavailableBucketTitle = "Listing not allowed with current credentials.";

function getBucketDisplayName(bucket: BrowserBucket, isPortalContext: boolean): string {
  if (isPortalContext) {
    return bucket.display_name?.trim() || bucket.workspace_label?.trim() || bucket.name;
  }
  return bucket.display_name?.trim() || bucket.name;
}

function formatUsagePercent(summary: BrowserUsageSummary): number | null {
  const used = summary.used_bytes;
  const quota = summary.quota_max_size_bytes;
  if (used == null || quota == null || quota <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (used / quota) * 100));
}

export default function BrowserWorkspaceSidebar({
  collapsed,
  isPortalContext,
  rows,
  activeBucketName,
  bucketFilter,
  loadingBuckets,
  bucketError,
  bucketManagementEnabled,
  canLoadMore,
  bucketMenuLoadingMore,
  bucketMenuTotal,
  bucketTotalCount,
  usageSummary,
  usageLoading,
  usageError,
  panelViewportRef,
  loadMoreSentinelRef,
  onToggleCollapsed,
  onBucketFilterChange,
  onRetryBuckets,
  onCreateBucket,
  onSelectBucket,
  onLoadMore,
  onOpenUsageMetrics,
}: BrowserWorkspaceSidebarProps) {
  const title = isPortalContext ? "Storage Spaces" : "Buckets";
  const searchPlaceholder = isPortalContext ? "Search storage spaces" : "Search buckets";
  const hasUsageGauge =
    usageSummary?.available === true && usageSummary.used_bytes != null;
  const usagePercent = usageSummary ? formatUsagePercent(usageSummary) : null;
  const usageLabel = usageSummary?.label || (isPortalContext ? "Storage Spaces" : "Account");
  const width = collapsed ? SIDEBAR_COMPACT_WIDTH : SIDEBAR_DEFAULT_WIDTH;
  const totalLabel = bucketTotalCount === 1 ? "1 item" : `${bucketTotalCount} items`;
  const filteredLabel =
    bucketFilter.trim().length > 0 && bucketMenuTotal !== bucketTotalCount
      ? `${bucketMenuTotal} result${bucketMenuTotal === 1 ? "" : "s"}`
      : totalLabel;

  return (
    <aside
      className="shell-sidebar relative flex h-full shrink-0 flex-col overflow-hidden rounded-lg border border-[color:var(--shell-border)] transition-[width] duration-200 ease-out"
      style={{ width }}
      aria-label={title}
      data-testid="browser-workspace-sidebar"
    >
      <div className={`flex h-12 shrink-0 items-center border-b border-[color:var(--shell-border-soft)] ${collapsed ? "justify-center px-2" : "gap-2 px-3"}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-white shadow-[0_10px_20px_rgba(37,99,235,0.22)]">
          <BucketCollectionIcon className="h-4 w-4" />
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[var(--shell-text)]">{title}</p>
            <p className="truncate text-[11px] font-medium text-[var(--shell-muted-text)]">{filteredLabel}</p>
          </div>
        )}
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--shell-muted-text)] transition hover:bg-[var(--shell-hover-bg)] hover:text-[var(--shell-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand workspace sidebar" : "Collapse workspace sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <span aria-hidden="true" className="text-sm font-semibold">
            {collapsed ? ">" : "<"}
          </span>
        </button>
      </div>

      {!collapsed && (
        <div className="shrink-0 space-y-2 border-b border-[color:var(--shell-border-soft)] px-3 py-3">
          <label className="block">
            <span className="sr-only">{searchPlaceholder}</span>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={bucketFilter}
                onChange={(event) => onBucketFilterChange(event.target.value)}
                placeholder={searchPlaceholder}
                className={cx(toolbarCompactInputClasses, "w-full py-2 pl-9 font-medium")}
                spellCheck={false}
              />
            </div>
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={toolbarCompactButtonClasses}
              onClick={onRetryBuckets}
              disabled={loadingBuckets}
              aria-label={`Refresh ${title.toLowerCase()}`}
              title="Refresh"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
              {loadingBuckets ? "Refreshing" : "Refresh"}
            </button>
            {bucketManagementEnabled && (
              <button type="button" className={toolbarCompactButtonClasses} onClick={onCreateBucket}>
                + Bucket
              </button>
            )}
          </div>
          {bucketError && (
            <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{bucketError}</p>
          )}
        </div>
      )}

      <div
        ref={panelViewportRef}
        className={`shell-sidebar-scroll min-h-0 flex-1 overflow-y-auto ${collapsed ? "px-2 py-2" : "px-2.5 py-3"}`}
      >
        <div className="space-y-1.5">
          {rows.map(({ bucket, access }) => {
            const isActive = bucket.name === activeBucketName;
            const displayName = getBucketDisplayName(bucket, isPortalContext);
            const rowTitle =
              access.status === "unavailable"
                ? unavailableBucketTitle
                : isPortalContext
                  ? displayName
                  : bucket.name;
            const rowClasses = collapsed
              ? `relative flex h-9 w-full items-center justify-center rounded-md transition ${
                  isActive ? "shell-sidebar-item-active" : "shell-sidebar-item"
                }`
              : `relative flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium leading-4 transition ${
                  isActive
                    ? "shell-sidebar-item-active before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-primary"
                    : "shell-sidebar-item"
                }`;
            return (
              <button
                key={bucket.name}
                type="button"
                className={rowClasses}
                onClick={() => onSelectBucket(bucket.name)}
                title={rowTitle}
                aria-current={isActive ? "page" : undefined}
                data-bucket-panel-name={bucket.name}
              >
                <BucketIcon className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{displayName}</span>
                      {!isPortalContext && bucket.workspace_label && (
                        <span className="block truncate text-[11px] font-medium text-[var(--shell-muted-text)]">
                          {bucket.workspace_label}
                        </span>
                      )}
                    </span>
                    <span
                      className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full border ${accessIndicatorClasses[access.status]}`}
                      aria-label={accessLabel[access.status]}
                      title={
                        access.status === "unavailable"
                          ? unavailableBucketTitle
                          : accessLabel[access.status]
                      }
                    >
                      <span className="sr-only">{accessLabel[access.status]}</span>
                    </span>
                  </>
                )}
              </button>
            );
          })}
          {loadingBuckets && rows.length === 0 && !collapsed && (
            <p className="px-2 py-2 ui-caption text-[var(--shell-muted-text)]">Loading...</p>
          )}
          {!loadingBuckets && rows.length === 0 && !collapsed && (
            <p className="px-2 py-2 ui-caption text-[var(--shell-muted-text)]">
              {bucketFilter.trim() ? "No matching item." : `No ${title.toLowerCase()} available.`}
            </p>
          )}
          {canLoadMore && !collapsed && (
            <button
              type="button"
              className={cx(toolbarCompactButtonClasses, "mx-1 mt-2 w-[calc(100%-0.5rem)] justify-center")}
              onClick={onLoadMore}
              disabled={bucketMenuLoadingMore}
            >
              {bucketMenuLoadingMore ? "Loading..." : "Load more"}
            </button>
          )}
          <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-1" />
        </div>
      </div>

      <div className={`sticky bottom-0 shrink-0 border-t border-[color:var(--shell-border-soft)] bg-[var(--shell-bg)] ${collapsed ? "px-2 py-2" : "space-y-2 px-3 py-3"}`}>
        {onOpenUsageMetrics && (
          <button
            type="button"
            className={collapsed ? "flex h-9 w-full items-center justify-center rounded-md shell-sidebar-item" : cx(toolbarCompactButtonClasses, "w-full justify-center")}
            onClick={onOpenUsageMetrics}
            aria-label="Usage & Metrics"
            title="Usage & Metrics"
          >
            <SlidersIcon className="h-3.5 w-3.5" />
            {!collapsed && <span>Usage & Metrics</span>}
          </button>
        )}
        {!collapsed && usageLoading && (
          <p className="ui-caption text-[var(--shell-muted-text)]">Loading usage...</p>
        )}
        {!collapsed && usageError && (
          <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">{usageError}</p>
        )}
        {!collapsed && hasUsageGauge && usageSummary && (
          <div className={cx(uiCardMutedClass, "rounded-lg p-3 shadow-none")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">{usageLabel}</p>
                <p className="mt-1 truncate ui-body font-semibold text-slate-900 dark:text-slate-100">
                  {formatBytes(usageSummary.used_bytes ?? 0)}
                </p>
              </div>
              {usageSummary.object_count != null && (
                <span className="shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {usageSummary.object_count.toLocaleString()} objects
                </span>
              )}
            </div>
            {usagePercent != null && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 ui-caption text-slate-500 dark:text-slate-400">
                  <span>{usagePercent.toFixed(0)}%</span>
                  <span>{formatBytes(usageSummary.quota_max_size_bytes ?? 0)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { bulkActionClasses } from "./browserConstants";
import type { BrowserObjectDetailsTab } from "./browserObjectDetailsModel";
import type { BrowserItem, ObjectDetailsTabId } from "./browserTypes";

export type BrowserObjectDetailsStatus = {
  message: string;
  tone: "success" | "error";
};

type BrowserObjectDetailsHeaderProps = {
  activeTab: ObjectDetailsTabId;
  bucketName: string;
  copyUrlDisabled: boolean;
  copyUrlDisabledReason?: string;
  currentStorageClass?: string | null;
  isDeleted: boolean;
  item: BrowserItem;
  onCopyUrl: () => Promise<void> | void;
  onDownload: () => void;
  onTabChange: (tab: ObjectDetailsTabId) => void;
  restoreStatusLabel?: string | null;
  status: BrowserObjectDetailsStatus | null;
  tabs: BrowserObjectDetailsTab[];
};

const statusClasses = {
  error:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/30 dark:text-rose-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-900/30 dark:text-emerald-100",
};

export default function BrowserObjectDetailsHeader({
  activeTab,
  bucketName,
  copyUrlDisabled,
  copyUrlDisabledReason,
  currentStorageClass,
  isDeleted,
  item,
  onCopyUrl,
  onDownload,
  onTabChange,
  restoreStatusLabel,
  status,
  tabs,
}: BrowserObjectDetailsHeaderProps) {
  return (
    <div className="sticky top-0 z-10 -mx-6 -mt-4 space-y-4 border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {isDeleted && (
              <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 ui-caption font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/30 dark:text-rose-100">
                Deleted
              </span>
            )}
            {restoreStatusLabel && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 ui-caption font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-100">
                {restoreStatusLabel}
              </span>
            )}
          </div>
          <div>
            <p className="break-all ui-subtitle font-semibold text-slate-900 dark:text-slate-50">
              {item.name}
            </p>
            <p className="break-all ui-caption text-slate-500 dark:text-slate-400">
              {bucketName} / {item.key}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 ui-caption text-slate-600 dark:text-slate-300">
            <span>Size: {item.size}</span>
            <span>Modified: {item.modified}</span>
            <span>Storage class: {currentStorageClass ?? "-"}</span>
          </div>
        </div>
        {!isDeleted && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={bulkActionClasses}
              onClick={onDownload}
            >
              Download
            </button>
            <button
              type="button"
              className={bulkActionClasses}
              onClick={() => void onCopyUrl()}
              disabled={copyUrlDisabled}
              title={
                copyUrlDisabled
                  ? (copyUrlDisabledReason ?? "Copy URL is unavailable.")
                  : undefined
              }
            >
              Copy URL
            </button>
          </div>
        )}
      </div>

      {status && (
        <div
          className={`rounded-lg border px-3 py-2 ui-caption font-semibold ${statusClasses[status.tone]}`}
        >
          {status.message}
        </div>
      )}

      {tabs.length > 0 && (
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Object details tabs"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onTabChange(tab.id)}
                className={[
                  "rounded-md px-3 py-1.5 ui-caption font-semibold transition",
                  isActive
                    ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

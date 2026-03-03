/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import Modal from "../../components/Modal";
import { bulkActionClasses, formInputClasses, toolbarPrimaryClasses } from "./browserConstants";
import { uiCheckboxClass } from "../../components/ui/styles";

type BrowserCleanupModalProps = {
  currentPath: string;
  cleanupKeepLast: string;
  setCleanupKeepLast: (value: string) => void;
  cleanupOlderThanDays: string;
  setCleanupOlderThanDays: (value: string) => void;
  cleanupDeleteOrphanMarkers: boolean;
  setCleanupDeleteOrphanMarkers: (value: boolean) => void;
  cleanupError: string | null;
  cleanupSummary: string | null;
  cleanupLoading: boolean;
  onApply: () => void;
  onClose: () => void;
};

export default function BrowserCleanupModal({
  currentPath,
  cleanupKeepLast,
  setCleanupKeepLast,
  cleanupOlderThanDays,
  setCleanupOlderThanDays,
  cleanupDeleteOrphanMarkers,
  setCleanupDeleteOrphanMarkers,
  cleanupError,
  cleanupSummary,
  cleanupLoading,
  onApply,
  onClose,
}: BrowserCleanupModalProps) {
  return (
    <Modal title="Clean old versions" onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4 ui-caption text-slate-600 dark:text-slate-300">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Context</p>
          <p className="break-all">{currentPath || "Select a bucket to get started."}</p>
        </div>
        {cleanupError && (
          <p className="font-semibold text-rose-600 dark:text-rose-200">{cleanupError}</p>
        )}
        {cleanupSummary && (
          <p className="font-semibold text-emerald-600 dark:text-emerald-200">{cleanupSummary}</p>
        )}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <label className="ui-caption font-semibold text-slate-500 dark:text-slate-400">
            Keep only the N most recent versions per object
          </label>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className={`${formInputClasses} mt-2`}
            value={cleanupKeepLast}
            onChange={(event) => setCleanupKeepLast(event.target.value)}
            placeholder="e.g. 3"
          />
          <label className="mt-3 ui-caption font-semibold text-slate-500 dark:text-slate-400">
            Delete versions older than (days)
          </label>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className={`${formInputClasses} mt-2`}
            value={cleanupOlderThanDays}
            onChange={(event) => setCleanupOlderThanDays(event.target.value)}
            placeholder="e.g. 30"
          />
          <label className="mt-3 flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={cleanupDeleteOrphanMarkers}
              onChange={(event) => setCleanupDeleteOrphanMarkers(event.target.checked)}
              className={uiCheckboxClass}
            />
            Delete orphan delete markers (runs after version cleanup)
          </label>
        </div>
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          If multiple rules are set, versions matching any rule are removed. The latest version is never deleted.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={bulkActionClasses} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={onApply}
            disabled={cleanupLoading}
          >
            {cleanupLoading ? "Cleaning..." : "Run cleanup"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

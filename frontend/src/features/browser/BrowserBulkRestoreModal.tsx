/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import Modal from "../../components/Modal";
import { bulkActionClasses, formInputClasses, toolbarPrimaryClasses } from "./browserConstants";

type BrowserBulkRestoreModalProps = {
  bulkActionFileCount: number;
  bulkActionFolderCount: number;
  bulkRestoreError: string | null;
  bulkRestoreSummary: string | null;
  bulkRestoreTargetPath?: string | null;
  bulkRestoreDryRun: boolean;
  setBulkRestoreDryRun: (value: boolean) => void;
  bulkRestorePreview?: {
    restoreKeys: string[];
    deleteKeys: string[];
    unchangedKeys: string[];
    totalRestore: number;
    totalDelete: number;
    totalUnchanged: number;
  } | null;
  bulkRestoreDate: string;
  setBulkRestoreDate: (value: string) => void;
  bulkRestoreDeleteMissing: boolean;
  setBulkRestoreDeleteMissing: (value: boolean) => void;
  bulkRestoreLoading: boolean;
  onApply: () => void;
  onClose: () => void;
};

export default function BrowserBulkRestoreModal({
  bulkActionFileCount,
  bulkActionFolderCount,
  bulkRestoreError,
  bulkRestoreSummary,
  bulkRestoreTargetPath,
  bulkRestoreDryRun,
  setBulkRestoreDryRun,
  bulkRestorePreview,
  bulkRestoreDate,
  setBulkRestoreDate,
  bulkRestoreDeleteMissing,
  setBulkRestoreDeleteMissing,
  bulkRestoreLoading,
  onApply,
  onClose,
}: BrowserBulkRestoreModalProps) {
  return (
    <Modal title="Restore to date" onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4 ui-caption text-slate-600 dark:text-slate-300">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Targets</p>
          <p>
            {bulkActionFileCount} file(s) · {bulkActionFolderCount} folder(s)
            {bulkActionFolderCount > 0 && " (folders use prefix history)"}
          </p>
          {bulkRestoreTargetPath && (
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Path: <span className="font-semibold text-slate-700 dark:text-slate-100">{bulkRestoreTargetPath}</span>
            </p>
          )}
        </div>
        {bulkRestoreError && (
          <p className="font-semibold text-rose-600 dark:text-rose-200">{bulkRestoreError}</p>
        )}
        {bulkRestoreSummary && (
          <p className="font-semibold text-emerald-600 dark:text-emerald-200">{bulkRestoreSummary}</p>
        )}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <label className="ui-caption font-semibold text-slate-500 dark:text-slate-400">Target date</label>
          <input
            type="datetime-local"
            className={`${formInputClasses} mt-2`}
            value={bulkRestoreDate}
            onChange={(event) => setBulkRestoreDate(event.target.value)}
          />
          <label className="mt-3 flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={bulkRestoreDeleteMissing}
              onChange={(event) => setBulkRestoreDeleteMissing(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
            />
            Delete objects not present at the selected date
          </label>
          <label className="mt-3 flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={bulkRestoreDryRun}
              onChange={(event) => setBulkRestoreDryRun(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
            />
            Dry run (preview only)
          </label>
        </div>
        {bulkRestorePreview && (
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="font-semibold text-slate-800 dark:text-slate-100">Preview</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Restore {bulkRestorePreview.totalRestore} · Delete {bulkRestorePreview.totalDelete} · Unchanged{" "}
              {bulkRestorePreview.totalUnchanged}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">Restore</p>
                {bulkRestorePreview.restoreKeys.length === 0 ? (
                  <p className="ui-caption text-slate-400">No items</p>
                ) : (
                  bulkRestorePreview.restoreKeys.map((key) => (
                    <p key={`restore-${key}`} className="truncate ui-caption text-slate-600 dark:text-slate-300">
                      {key}
                    </p>
                  ))
                )}
                {bulkRestorePreview.totalRestore > bulkRestorePreview.restoreKeys.length && (
                  <p className="ui-caption text-slate-400">
                    +{bulkRestorePreview.totalRestore - bulkRestorePreview.restoreKeys.length} more
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">Delete</p>
                {bulkRestorePreview.deleteKeys.length === 0 ? (
                  <p className="ui-caption text-slate-400">No items</p>
                ) : (
                  bulkRestorePreview.deleteKeys.map((key) => (
                    <p key={`delete-${key}`} className="truncate ui-caption text-slate-600 dark:text-slate-300">
                      {key}
                    </p>
                  ))
                )}
                {bulkRestorePreview.totalDelete > bulkRestorePreview.deleteKeys.length && (
                  <p className="ui-caption text-slate-400">
                    +{bulkRestorePreview.totalDelete - bulkRestorePreview.deleteKeys.length} more
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">Unchanged</p>
                {bulkRestorePreview.unchangedKeys.length === 0 ? (
                  <p className="ui-caption text-slate-400">No items</p>
                ) : (
                  bulkRestorePreview.unchangedKeys.map((key) => (
                    <p key={`unchanged-${key}`} className="truncate ui-caption text-slate-600 dark:text-slate-300">
                      {key}
                    </p>
                  ))
                )}
                {bulkRestorePreview.totalUnchanged > bulkRestorePreview.unchangedKeys.length && (
                  <p className="ui-caption text-slate-400">
                    +{bulkRestorePreview.totalUnchanged - bulkRestorePreview.unchangedKeys.length} more
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          Restores the latest version at or before the selected date. Objects with a delete marker at that date are
          skipped unless deletion is enabled.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={bulkActionClasses} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={onApply}
            disabled={bulkRestoreLoading}
          >
            {bulkRestoreLoading ? (bulkRestoreDryRun ? "Previewing..." : "Restoring...") : bulkRestoreDryRun ? "Preview changes" : "Run restore"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

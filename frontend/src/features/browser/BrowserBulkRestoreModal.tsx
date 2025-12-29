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
      <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Targets</p>
          <p>
            {bulkActionFileCount} file(s) · {bulkActionFolderCount} folder(s)
            {bulkActionFolderCount > 0 && " (folders use prefix history)"}
          </p>
        </div>
        {bulkRestoreError && (
          <p className="font-semibold text-rose-600 dark:text-rose-200">{bulkRestoreError}</p>
        )}
        {bulkRestoreSummary && (
          <p className="font-semibold text-emerald-600 dark:text-emerald-200">{bulkRestoreSummary}</p>
        )}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Target date</label>
          <input
            type="datetime-local"
            className={`${formInputClasses} mt-2`}
            value={bulkRestoreDate}
            onChange={(event) => setBulkRestoreDate(event.target.value)}
          />
          <label className="mt-3 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={bulkRestoreDeleteMissing}
              onChange={(event) => setBulkRestoreDeleteMissing(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
            />
            Delete objects not present at the selected date
          </label>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
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
            {bulkRestoreLoading ? "Restoring..." : "Run restore"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Modal from "../../components/Modal";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { browserPanelCardClasses, bulkActionClasses, formInputClasses, toolbarPrimaryClasses } from "./browserConstants";
import { stableSignature } from "../../utils/stableSignature";
import type {
  BrowserBulkRestoreDraft,
  BrowserBulkRestorePreview,
} from "./useBrowserBulkRestore";

type BrowserBulkRestoreModalProps = {
  draft: BrowserBulkRestoreDraft;
  error: string | null;
  fileCount: number;
  folderCount: number;
  loading: boolean;
  onApply: () => void;
  onClose: () => void;
  preview?: BrowserBulkRestorePreview | null;
  setDraft: Dispatch<SetStateAction<BrowserBulkRestoreDraft>>;
  summary: string | null;
  targetPath?: string | null;
};

export default function BrowserBulkRestoreModal({
  draft,
  error,
  fileCount,
  folderCount,
  loading,
  onApply,
  onClose,
  preview,
  setDraft,
  summary,
  targetPath,
}: BrowserBulkRestoreModalProps) {
  const currentSignature = useMemo(
    () => stableSignature(draft),
    [draft],
  );
  const [initialSignature] = useState(currentSignature);
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: currentSignature !== initialSignature,
    onClose,
    disabled: loading,
  });
  const updateDraft = <Key extends keyof BrowserBulkRestoreDraft>(
    key: Key,
    value: BrowserBulkRestoreDraft[Key],
  ) =>
    setDraft((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "restoreDeleted" && value === true
        ? { deleteMissing: false }
        : {}),
    }));

  return (
    <Modal title="Restore to date" onClose={closeGuard.requestClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4 ui-caption text-slate-600 dark:text-slate-300">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Targets</p>
          <p>
            {fileCount} file(s) · {folderCount} folder(s)
            {folderCount > 0 && " (folders use prefix history)"}
          </p>
          {targetPath && (
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Path: <span className="font-semibold text-slate-700 dark:text-slate-100">{targetPath}</span>
            </p>
          )}
        </div>
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        {summary && <UiInlineMessage tone="success">{summary}</UiInlineMessage>}
        <div className={browserPanelCardClasses}>
          <UiCheckboxField
            checked={draft.restoreDeleted}
            onChange={(event) => updateDraft("restoreDeleted", event.target.checked)}
            className="ui-caption text-slate-500 dark:text-slate-400"
          >
            Restore deleted objects to their latest version
          </UiCheckboxField>
          <div className={`mt-3 space-y-2 ${draft.restoreDeleted ? "opacity-60" : ""}`}>
            <label className="ui-caption font-semibold text-slate-500 dark:text-slate-400">Target date</label>
            <input
              type="datetime-local"
              className={formInputClasses}
              value={draft.date}
              onChange={(event) => updateDraft("date", event.target.value)}
              disabled={draft.restoreDeleted}
            />
            {draft.restoreDeleted && (
              <p className="ui-caption text-slate-400">Date is ignored while latest deleted-object restore is enabled.</p>
            )}
          </div>
          <UiCheckboxField
            checked={draft.deleteMissing}
            onChange={(event) => updateDraft("deleteMissing", event.target.checked)}
            disabled={draft.restoreDeleted}
            className={`mt-3 ui-caption ${
              draft.restoreDeleted ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            Delete objects not present at the selected date
          </UiCheckboxField>
          <UiCheckboxField
            checked={draft.dryRun}
            onChange={(event) => updateDraft("dryRun", event.target.checked)}
            className="mt-3 ui-caption text-slate-500 dark:text-slate-400"
          >
            Dry run (preview only)
          </UiCheckboxField>
        </div>
        {preview && (
          <div className={browserPanelCardClasses}>
            <p className="font-semibold text-slate-800 dark:text-slate-100">Preview</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Restore {preview.totalRestore} · Delete {preview.totalDelete} · Unchanged{" "}
              {preview.totalUnchanged}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">Restore</p>
                {preview.restoreKeys.length === 0 ? (
                  <p className="ui-caption text-slate-400">No items</p>
                ) : (
                  preview.restoreKeys.map((key) => (
                    <p key={`restore-${key}`} className="truncate ui-caption text-slate-600 dark:text-slate-300">
                      {key}
                    </p>
                  ))
                )}
                {preview.totalRestore > preview.restoreKeys.length && (
                  <p className="ui-caption text-slate-400">
                    +{preview.totalRestore - preview.restoreKeys.length} more
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">Delete</p>
                {preview.deleteKeys.length === 0 ? (
                  <p className="ui-caption text-slate-400">No items</p>
                ) : (
                  preview.deleteKeys.map((key) => (
                    <p key={`delete-${key}`} className="truncate ui-caption text-slate-600 dark:text-slate-300">
                      {key}
                    </p>
                  ))
                )}
                {preview.totalDelete > preview.deleteKeys.length && (
                  <p className="ui-caption text-slate-400">
                    +{preview.totalDelete - preview.deleteKeys.length} more
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">Unchanged</p>
                {preview.unchangedKeys.length === 0 ? (
                  <p className="ui-caption text-slate-400">No items</p>
                ) : (
                  preview.unchangedKeys.map((key) => (
                    <p key={`unchanged-${key}`} className="truncate ui-caption text-slate-600 dark:text-slate-300">
                      {key}
                    </p>
                  ))
                )}
                {preview.totalUnchanged > preview.unchangedKeys.length && (
                  <p className="ui-caption text-slate-400">
                    +{preview.totalUnchanged - preview.unchangedKeys.length} more
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          {draft.restoreDeleted
            ? "Restores deleted objects to their latest non-delete-marker version. Target date is ignored in this mode."
            : "Restores the latest version at or before the selected date. Objects with a delete marker at that date are skipped unless deletion is enabled or deleted-object restore is selected."}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={bulkActionClasses} onClick={closeGuard.requestClose}>
            Cancel
          </button>
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={onApply}
            disabled={loading}
          >
            {loading ? (draft.dryRun ? "Previewing..." : "Restoring...") : draft.dryRun ? "Preview changes" : "Run restore"}
          </button>
        </div>
      </div>
      {closeGuard.confirmationDialog}
    </Modal>
  );
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import Modal from "../../components/Modal";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { browserPanelCardClasses, bulkActionClasses, formInputClasses, toolbarPrimaryClasses } from "./browserConstants";
import { stableSignature } from "../../utils/stableSignature";

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
  const currentSignature = useMemo(
    () =>
      stableSignature({
        cleanupKeepLast,
        cleanupOlderThanDays,
        cleanupDeleteOrphanMarkers,
      }),
    [cleanupDeleteOrphanMarkers, cleanupKeepLast, cleanupOlderThanDays]
  );
  const [initialSignature] = useState(currentSignature);
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: currentSignature !== initialSignature,
    onClose,
    disabled: cleanupLoading,
  });

  return (
    <Modal title="Clean old versions" onClose={closeGuard.requestClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4 ui-caption text-slate-600 dark:text-slate-300">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Context</p>
          <p className="break-all">{currentPath || "Select a bucket to get started."}</p>
        </div>
        {cleanupError && <UiInlineMessage tone="error">{cleanupError}</UiInlineMessage>}
        {cleanupSummary && <UiInlineMessage tone="success">{cleanupSummary}</UiInlineMessage>}
        <div className={browserPanelCardClasses}>
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
          <UiCheckboxField
            checked={cleanupDeleteOrphanMarkers}
            onChange={(event) => setCleanupDeleteOrphanMarkers(event.target.checked)}
            className="mt-3 ui-caption text-slate-500 dark:text-slate-400"
          >
            Delete orphan delete markers (runs after version cleanup)
          </UiCheckboxField>
        </div>
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          If multiple rules are set, versions matching any rule are removed. The latest version is never deleted.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={bulkActionClasses} onClick={closeGuard.requestClose}>
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
      {closeGuard.confirmationDialog}
    </Modal>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  browserPanelCardClasses,
  formInputClasses,
  toolbarPrimaryClasses,
} from "./browserConstants";
import type { ObjectRestoreTier } from "./useBrowserObjectArchiveRestore";

type BrowserObjectArchiveTabProps = {
  currentStorageClass?: string | null;
  days: string;
  onDaysChange: (value: string) => void;
  onRestore: () => Promise<void> | void;
  onTierChange: (value: ObjectRestoreTier) => void;
  restoreStatusLabel?: string | null;
  saving: boolean;
  tier: ObjectRestoreTier;
};

export default function BrowserObjectArchiveTab({
  currentStorageClass,
  days,
  onDaysChange,
  onRestore,
  onTierChange,
  restoreStatusLabel,
  saving,
  tier,
}: BrowserObjectArchiveTabProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className={browserPanelCardClasses}>
        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
          Archive restore
        </p>
        <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
          Restore archived objects (GLACIER, GLACIER_IR, DEEP_ARCHIVE) for a
          limited duration.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Days</span>
            <input
              type="number"
              min={1}
              className={formInputClasses}
              value={days}
              onChange={(event) => onDaysChange(event.target.value)}
            />
          </label>
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Tier</span>
            <select
              className={formInputClasses}
              value={tier}
              onChange={(event) =>
                onTierChange(event.target.value as ObjectRestoreTier)
              }
            >
              <option value="Standard">Standard</option>
              <option value="Bulk">Bulk</option>
              <option value="Expedited">Expedited</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            className={toolbarPrimaryClasses}
            onClick={() => void onRestore()}
            disabled={saving}
          >
            {saving ? "Submitting..." : "Request restore"}
          </button>
        </div>
      </div>

      <div className={browserPanelCardClasses}>
        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">
          Current status
        </p>
        <div className="mt-2 space-y-2 ui-caption text-slate-600 dark:text-slate-300">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">Storage class</span>
            <span className="font-semibold text-slate-700 dark:text-slate-100">
              {currentStorageClass ?? "-"}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-slate-500">Restore status</span>
            <span className="max-w-[24rem] text-right font-semibold text-slate-700 dark:text-slate-100">
              {restoreStatusLabel ?? "No active restore."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

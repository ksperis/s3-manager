/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ActionProgressCard from "./ActionProgressCard";
import type { ActionProgressState } from "./actionProgress";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiInputClass,
  uiMenuClass,
  uiMenuItemClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";

type SelectionTagAction = "add" | "remove";
type SelectionExportFormat = "text" | "csv" | "json";

type BucketSelectionActionsBarProps = {
  selectedCount: number;
  hiddenSelectedCount: number;
  clearSelection: () => void;
  availableUiTags: string[];
  selectedUiTagSuggestions: string[];
  selectionTagAddInput: string;
  setSelectionTagAddInput: (value: string) => void;
  parsedSelectionTagAddInput: string[];
  selectionTagActionLoading: SelectionTagAction | null;
  applyUiTagToSelection: (tag: string, action: SelectionTagAction) => Promise<void> | void;
  selectionExportLoading: SelectionExportFormat | null;
  exportSelectedBuckets: (format: SelectionExportFormat) => Promise<void> | void;
  selectionActionProgress?: ActionProgressState | null;
  isStorageOps: boolean;
  onShowConfigBackupModal?: () => void;
  onShowCompareModal: () => void;
  onShowIntegrityModal: () => void;
  openBulkUpdateModal: () => void;
};

const selectionSummaryClass = cx(
  uiButtonBaseClass,
  uiButtonVariants.secondary,
  "list-none px-2.5 py-1.5 [&::-webkit-details-marker]:hidden"
);
const selectionMenuClass = cx(uiMenuClass, "absolute left-0 z-50 mt-1 p-2");
const selectionMenuItemClass = cx(
  uiMenuItemClass,
  "flex w-full items-center text-left ui-caption font-semibold disabled:cursor-not-allowed disabled:opacity-60"
);
const selectionActionButtonClass = cx(uiButtonBaseClass, uiButtonVariants.secondary, "px-2.5 py-1.5");

export default function BucketSelectionActionsBar({
  selectedCount,
  hiddenSelectedCount,
  clearSelection,
  availableUiTags,
  selectedUiTagSuggestions,
  selectionTagAddInput,
  setSelectionTagAddInput,
  parsedSelectionTagAddInput,
  selectionTagActionLoading,
  applyUiTagToSelection,
  selectionExportLoading,
  exportSelectedBuckets,
  selectionActionProgress,
  isStorageOps,
  onShowConfigBackupModal,
  onShowCompareModal,
  onShowIntegrityModal,
  openBulkUpdateModal,
}: BucketSelectionActionsBarProps) {
  if (selectedCount <= 0) return null;

  return (
    <div className="border-b border-[color:var(--ui-border-soft)] px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cx("ui-body", uiTitleTextClass)}>
            {selectedCount} bucket{selectedCount > 1 ? "s" : ""} selected
            {hiddenSelectedCount > 0 && (
              <span className="ml-2 ui-caption font-semibold text-red-600 dark:text-red-400">
                ({hiddenSelectedCount} not visible)
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={clearSelection}
            className={cx(uiButtonBaseClass, uiButtonVariants.danger, "px-2.5 py-1.5")}
          >
            Clear selection
          </button>
          <details className="relative">
            <summary className={selectionSummaryClass}>
              + Tag selection
            </summary>
            <div className={cx(selectionMenuClass, "w-64")}>
              {availableUiTags.length === 0 ? (
                <p className={cx("ui-caption", uiMutedTextClass)}>No existing UI tags yet.</p>
              ) : (
                <>
                  <p className={cx("px-1 pb-1 ui-caption font-semibold uppercase", uiMutedTextClass)}>
                    Suggestions
                  </p>
                  <div className="max-h-40 space-y-1 overflow-auto">
                    {availableUiTags.map((tag) => (
                      <button
                        key={`selection-add:${tag}`}
                        type="button"
                        className={cx(selectionMenuItemClass, "!px-2 !py-1")}
                        onClick={(event) => {
                          event.preventDefault();
                          void applyUiTagToSelection(tag, "add");
                          const parent = event.currentTarget.closest("details");
                          if (parent) parent.removeAttribute("open");
                        }}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="mt-2 space-y-1 border-t border-[color:var(--ui-border-soft)] pt-2">
                <p className={cx("px-1 ui-caption font-semibold uppercase", uiMutedTextClass)}>Custom</p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={selectionTagAddInput}
                    onChange={(event) => setSelectionTagAddInput(event.target.value)}
                    placeholder="new-tag"
                    className={cx(uiInputClass, "min-w-0 flex-1 px-2 py-1 ui-caption")}
                  />
                  <button
                    type="button"
                    className={cx(uiButtonBaseClass, uiButtonVariants.primary, "px-2 py-1")}
                    disabled={parsedSelectionTagAddInput.length === 0 || selectionTagActionLoading !== null}
                    onClick={(event) => {
                      event.preventDefault();
                      const customTag = selectionTagAddInput;
                      setSelectionTagAddInput("");
                      void applyUiTagToSelection(customTag, "add");
                      const parent = event.currentTarget.closest("details");
                      if (parent) parent.removeAttribute("open");
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </details>
          <details className="relative">
            <summary className={selectionSummaryClass}>
              - Tag selection
            </summary>
            <div className={cx(selectionMenuClass, "w-64")}>
              {selectedUiTagSuggestions.length === 0 ? (
                <p className={cx("ui-caption", uiMutedTextClass)}>No UI tags found on this selection.</p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-auto">
                  {selectedUiTagSuggestions.map((tag) => (
                    <button
                        key={`selection-remove:${tag}`}
                        type="button"
                        className={cx(selectionMenuItemClass, "!px-2 !py-1")}
                        onClick={(event) => {
                        event.preventDefault();
                        void applyUiTagToSelection(tag, "remove");
                        const parent = event.currentTarget.closest("details");
                        if (parent) parent.removeAttribute("open");
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </details>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <details className="relative">
            <summary className={selectionSummaryClass}>
              {selectionExportLoading ? "Exporting..." : "Export list"}
            </summary>
            <div className={cx(uiMenuClass, "absolute left-0 z-50 mt-1 w-72 p-1.5")}>
              <button
                type="button"
                className={selectionMenuItemClass}
                disabled={selectionExportLoading !== null}
                onClick={(event) => {
                  event.preventDefault();
                  void exportSelectedBuckets("text");
                  const parent = event.currentTarget.closest("details");
                  if (parent) parent.removeAttribute("open");
                }}
              >
                Text (bucket names only)
              </button>
              <button
                type="button"
                className={selectionMenuItemClass}
                disabled={selectionExportLoading !== null}
                onClick={(event) => {
                  event.preventDefault();
                  void exportSelectedBuckets("csv");
                  const parent = event.currentTarget.closest("details");
                  if (parent) parent.removeAttribute("open");
                }}
              >
                CSV (selected columns)
              </button>
              <button
                type="button"
                className={selectionMenuItemClass}
                disabled={selectionExportLoading !== null}
                onClick={(event) => {
                  event.preventDefault();
                  void exportSelectedBuckets("json");
                  const parent = event.currentTarget.closest("details");
                  if (parent) parent.removeAttribute("open");
                }}
              >
                JSON (selected columns)
              </button>
            </div>
          </details>
          <button
            type="button"
            onClick={onShowIntegrityModal}
            className={selectionActionButtonClass}
          >
            Check integrity
          </button>
          {!isStorageOps && onShowConfigBackupModal && (
            <button
              type="button"
              onClick={onShowConfigBackupModal}
              className={selectionActionButtonClass}
            >
              Backup configs
            </button>
          )}
          {!isStorageOps && (
            <button
              type="button"
              onClick={onShowCompareModal}
              className={selectionActionButtonClass}
            >
              Compare buckets
            </button>
          )}
          <button
            type="button"
            onClick={openBulkUpdateModal}
            className={cx(uiButtonBaseClass, uiButtonVariants.primary, "px-2.5 py-1.5")}
          >
            Bulk update
          </button>
        </div>
      </div>
      {selectionActionProgress && (
        <ActionProgressCard progress={selectionActionProgress} busy className="mt-3" />
      )}
    </div>
  );
}

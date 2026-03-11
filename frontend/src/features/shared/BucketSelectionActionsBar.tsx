/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

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
  isStorageOps: boolean;
  onShowCompareModal: () => void;
  openBulkUpdateModal: () => void;
};

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
  isStorageOps,
  onShowCompareModal,
  openBulkUpdateModal,
}: BucketSelectionActionsBarProps) {
  if (selectedCount <= 0) return null;

  return (
    <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
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
            className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 ui-caption font-semibold text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
          >
            Clear selection
          </button>
          <details className="relative">
            <summary className="list-none rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600 [&::-webkit-details-marker]:hidden">
              + Tag selection
            </summary>
            <div className="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {availableUiTags.length === 0 ? (
                <p className="ui-caption text-slate-500 dark:text-slate-400">No existing UI tags yet.</p>
              ) : (
                <>
                  <p className="px-1 pb-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Suggestions
                  </p>
                  <div className="max-h-40 space-y-1 overflow-auto">
                    {availableUiTags.map((tag) => (
                      <button
                        key={`selection-add:${tag}`}
                        type="button"
                        className="flex w-full items-center rounded-md px-2 py-1 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
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
              <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
                <p className="px-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Custom</p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={selectionTagAddInput}
                    onChange={(event) => setSelectionTagAddInput(event.target.value)}
                    placeholder="new-tag"
                    className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    className="rounded-md bg-primary px-2 py-1 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
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
            <summary className="list-none rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600 [&::-webkit-details-marker]:hidden">
              - Tag selection
            </summary>
            <div className="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {selectedUiTagSuggestions.length === 0 ? (
                <p className="ui-caption text-slate-500 dark:text-slate-400">No UI tags found on this selection.</p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-auto">
                  {selectedUiTagSuggestions.map((tag) => (
                    <button
                      key={`selection-remove:${tag}`}
                      type="button"
                      className="flex w-full items-center rounded-md px-2 py-1 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
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
            <summary className="list-none rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600 [&::-webkit-details-marker]:hidden">
              {selectionExportLoading ? "Exporting..." : "Export list"}
            </summary>
            <div className="absolute left-0 z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800"
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
                className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800"
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
                className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800"
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
          {!isStorageOps && (
            <button
              type="button"
              onClick={onShowCompareModal}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
            >
              Compare buckets
            </button>
          )}
          <button
            type="button"
            onClick={openBulkUpdateModal}
            className="rounded-md bg-primary px-2.5 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600"
          >
            Bulk update
          </button>
        </div>
      </div>
    </div>
  );
}

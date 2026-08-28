/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import UiDetails from "../../components/ui/UiDetails";
import ActionProgressCard from "./ActionProgressCard";
import type { ActionProgressState } from "./actionProgress";
import {
  type BulkOperation,
  type BulkPreviewItem,
  type BulkPreviewLine,
  type BulkPreviewTone,
} from "./bucketBulkOperationsModel";
import {
  buildBulkPreviewSections,
  summarizeBulkPreview,
} from "./bucketBulkPreviewModel";

type AsyncAction = () => void | Promise<void>;

export type BucketOpsBulkExecutionPanelProps = {
  applyDisabled: boolean;
  applyError: string | null;
  applyLoading: boolean;
  applyProgress: ActionProgressState | null;
  applySummary: string | null;
  copyDisabled: boolean;
  copyError: string | null;
  copyLoading: boolean;
  copyProgress: ActionProgressState | null;
  copySummary: string | null;
  onApply: AsyncAction;
  onClose: () => void;
  onCopy: AsyncAction;
  onExport: () => void;
  onPreview: AsyncAction;
  operation: BulkOperation;
  pasteError: string | null;
  previewDisabled: boolean;
  previewError: string | null;
  previewItems: BulkPreviewItem[];
  previewLoading: boolean;
  previewProgress: ActionProgressState | null;
  previewReady: boolean;
};

const diffToneClasses = (tone?: BulkPreviewTone) => {
  if (tone === "added") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100";
  }
  if (tone === "removed") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100";
  }
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";
};

const renderPreviewLines = (lines: BulkPreviewLine[]) => (
  <div className="space-y-2">
    {lines.map((line, index) => (
      <pre
        key={`${line.text}-${index}`}
        className={`whitespace-pre-wrap break-words rounded-md border px-2 py-1 font-mono text-[11px] leading-relaxed ${diffToneClasses(
          line.tone,
        )}`}
      >
        {line.text}
      </pre>
    ))}
  </div>
);

const bucketPreviewBadgeClasses = (item: BulkPreviewItem) => {
  if (item.error) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100";
  }
  if (item.changed) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100";
  }
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";
};

const sectionPreviewBadgeClasses = (changed: boolean) =>
  changed
    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
    : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";

function BulkPreviewDetails({
  items,
  operation,
}: {
  items: BulkPreviewItem[];
  operation: BulkOperation;
}) {
  if (items.length === 0) return null;
  return (
    <div className="max-h-[420px] space-y-2 overflow-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
      {items.map((item) => {
        const sections = buildBulkPreviewSections(item, operation);
        const changedSections = sections.filter(
          (section) => section.changed,
        ).length;
        return (
          <UiDetails
            key={item.bucket}
            defaultOpen={Boolean(item.error || item.changed)}
            className="rounded-lg border border-slate-200 dark:border-slate-800"
          >
            <summary className="cursor-pointer list-none px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {item.bucket}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${bucketPreviewBadgeClasses(item)}`}
                >
                  {item.error ? "Error" : item.changed ? "Change" : "No change"}
                </span>
                <span className="ui-caption text-slate-500 dark:text-slate-400">
                  Changed sections {changedSections}/{sections.length}
                </span>
              </div>
            </summary>
            <div className="space-y-2 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
              {sections.map((section) => (
                <UiDetails
                  key={`${item.bucket}:${section.key}`}
                  defaultOpen={Boolean(section.error || section.changed)}
                  className="rounded-md border border-slate-200 dark:border-slate-800"
                >
                  <summary className="cursor-pointer list-none px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                        {section.label}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sectionPreviewBadgeClasses(section.changed)}`}
                      >
                        {section.changed ? "Changed" : "Unchanged"}
                      </span>
                    </div>
                  </summary>
                  <div className="space-y-2 border-t border-slate-200 px-2.5 py-2 dark:border-slate-800">
                    {section.error ? (
                      <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                        {section.error}
                      </p>
                    ) : (
                      <div className="grid gap-2 lg:grid-cols-2">
                        <div className="space-y-1">
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Before
                          </p>
                          {renderPreviewLines(section.before)}
                        </div>
                        <div className="space-y-1">
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            After
                          </p>
                          {renderPreviewLines(section.after)}
                        </div>
                      </div>
                    )}
                  </div>
                </UiDetails>
              ))}
            </div>
          </UiDetails>
        );
      })}
    </div>
  );
}

export default function BucketOpsBulkExecutionPanel({
  applyDisabled,
  applyError,
  applyLoading,
  applyProgress,
  applySummary,
  copyDisabled,
  copyError,
  copyLoading,
  copyProgress,
  copySummary,
  onApply,
  onClose,
  onCopy,
  onExport,
  onPreview,
  operation,
  pasteError,
  previewDisabled,
  previewError,
  previewItems,
  previewLoading,
  previewProgress,
  previewReady,
}: BucketOpsBulkExecutionPanelProps) {
  const previewStats = useMemo(
    () => summarizeBulkPreview(previewItems),
    [previewItems],
  );

  return (
    <>
      {operation === "paste_configs" && pasteError && (
        <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
          {pasteError}
        </p>
      )}
      {copyError && (
        <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
          {copyError}
        </p>
      )}
      {copySummary && (
        <p className="ui-caption font-semibold text-emerald-600 dark:text-emerald-200">
          {copySummary}
        </p>
      )}
      {previewError && (
        <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
          {previewError}
        </p>
      )}
      {applyError && (
        <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
          {applyError}
        </p>
      )}
      {applySummary && (
        <p className="ui-caption font-semibold text-emerald-600 dark:text-emerald-200">
          {applySummary}
        </p>
      )}

      {copyLoading && copyProgress && (
        <ActionProgressCard progress={copyProgress} unitLabel="buckets" />
      )}
      {previewLoading && previewProgress && (
        <ActionProgressCard progress={previewProgress} unitLabel="buckets" />
      )}
      {applyLoading && applyProgress && (
        <ActionProgressCard progress={applyProgress} unitLabel="buckets" />
      )}

      <div className="flex flex-wrap items-center gap-3">
        {operation === "copy_configs" ? (
          <button
            type="button"
            onClick={() => void onCopy()}
            disabled={copyDisabled}
            className="rounded-md bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copyLoading ? "Copying..." : "Copy selected configs"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void onPreview()}
              disabled={previewDisabled}
              className="rounded-md bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {previewLoading ? "Previewing..." : "Preview"}
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={previewLoading || previewItems.length === 0}
              className="rounded-md border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
            >
              Export changes
            </button>
            {previewReady && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Changes: {previewStats.changed} / Unchanged:{" "}
                {previewStats.unchanged} / Errors: {previewStats.errors}
              </p>
            )}
          </>
        )}
      </div>

      <BulkPreviewDetails items={previewItems} operation={operation} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-full border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200"
          onClick={onClose}
        >
          Cancel
        </button>
        {operation !== "copy_configs" && (
          <button
            type="button"
            className="rounded-full bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void onApply()}
            disabled={applyDisabled}
          >
            {applyLoading ? "Applying..." : "Apply changes"}
          </button>
        )}
      </div>
    </>
  );
}

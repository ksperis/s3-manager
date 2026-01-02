/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import Modal from "../../components/Modal";
import { bulkActionClasses } from "./browserConstants";
import { previewLabelForItem } from "./browserUtils";
import type { BrowserItem, PreviewKind } from "./browserTypes";

type BrowserPreviewModalProps = {
  previewItem: BrowserItem | null;
  previewUrl: string | null;
  previewContentType: string | null;
  previewKind: PreviewKind | null;
  previewLoading: boolean;
  previewError: string | null;
  onClose: () => void;
  onDownload: (items: BrowserItem[]) => void;
};

export default function BrowserPreviewModal({
  previewItem,
  previewUrl,
  previewContentType,
  previewKind,
  previewLoading,
  previewError,
  onClose,
  onDownload,
}: BrowserPreviewModalProps) {
  if (!previewItem) return null;

  return (
    <Modal
      title={`Preview: ${previewItem.name}`}
      onClose={onClose}
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="break-all ui-body font-semibold text-slate-800 dark:text-slate-100">
              {previewItem.key}
            </p>
            <div className="flex flex-wrap gap-3 ui-caption text-slate-500 dark:text-slate-400">
              <span>{previewItem.size}</span>
              <span>{previewItem.modified}</span>
              <span>{previewLabelForItem(previewItem)}</span>
              {previewContentType && <span>{previewContentType}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={bulkActionClasses}
              onClick={() => onDownload([previewItem])}
            >
              Download
            </button>
            {previewUrl && (
              <a
                className={bulkActionClasses}
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
          {previewLoading && (
            <div className="ui-body text-slate-500 dark:text-slate-300">Loading preview...</div>
          )}
          {previewError && (
            <div className="ui-body font-semibold text-rose-600 dark:text-rose-200">{previewError}</div>
          )}
          {!previewLoading && !previewError && previewUrl && previewKind === "image" && (
            <img
              src={previewUrl}
              alt={previewItem.name}
              className="max-h-[60vh] w-full rounded-lg bg-white object-contain dark:bg-slate-950"
            />
          )}
          {!previewLoading && !previewError && previewUrl && previewKind === "video" && (
            <video
              src={previewUrl}
              controls
              className="max-h-[60vh] w-full rounded-lg bg-black"
            />
          )}
          {!previewLoading && !previewError && previewUrl && previewKind === "audio" && (
            <audio src={previewUrl} controls className="w-full" />
          )}
          {!previewLoading &&
            !previewError &&
            previewUrl &&
            (previewKind === "pdf" || previewKind === "text") && (
              <iframe
                title="Object preview"
                src={previewUrl}
                className="h-[60vh] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
              />
            )}
          {!previewLoading && !previewError && (!previewUrl || previewKind === "generic") && (
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center ui-body text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Preview not available for this file type.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import Modal from "../../components/Modal";
import { formatBytes } from "../../utils/format";
import { bulkActionClasses, bulkDangerClasses, toolbarButtonClasses } from "./browserConstants";
import { formatDateTime } from "./browserUtils";
import type { BrowserObjectVersion } from "../../api/browser";

type BrowserPrefixVersionsModalProps = {
  bucketName: string;
  normalizedPrefix: string;
  prefixVersionsLoading: boolean;
  prefixVersionsError: string | null;
  prefixVersionRows: BrowserObjectVersion[];
  prefixVersionKeyMarker: string | null;
  prefixVersionIdMarker: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRestoreVersion: (version: BrowserObjectVersion) => void;
  onDeleteVersion: (version: BrowserObjectVersion) => void;
};

export default function BrowserPrefixVersionsModal({
  bucketName,
  normalizedPrefix,
  prefixVersionsLoading,
  prefixVersionsError,
  prefixVersionRows,
  prefixVersionKeyMarker,
  prefixVersionIdMarker,
  onClose,
  onRefresh,
  onLoadMore,
  onRestoreVersion,
  onDeleteVersion,
}: BrowserPrefixVersionsModalProps) {
  return (
    <Modal
      title={`Prefix versions${normalizedPrefix ? ` · ${normalizedPrefix}` : ""}`}
      onClose={onClose}
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
          <span className="font-semibold">
            Prefix {normalizedPrefix ? normalizedPrefix : "/"}
          </span>
          <div className="flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
            {prefixVersionsLoading && <span>Loading...</span>}
            <button
              type="button"
              className={toolbarButtonClasses}
              onClick={onRefresh}
              disabled={!bucketName || prefixVersionsLoading}
            >
              Refresh
            </button>
          </div>
        </div>
        {prefixVersionsError && <div className="ui-caption text-rose-600 dark:text-rose-200">{prefixVersionsError}</div>}
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {prefixVersionRows.length === 0 && !prefixVersionsLoading && (
              <div className="px-3 py-3 ui-caption text-slate-500 dark:text-slate-300">No versions found.</div>
            )}
            {prefixVersionRows.map((ver) => (
              <div
                key={`${ver.key}-${ver.version_id ?? "none"}-${ver.is_delete_marker ? "marker" : "version"}`}
                className="flex flex-wrap items-start justify-between gap-3 px-3 py-2 ui-caption"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{ver.key}</span>
                    {ver.is_delete_marker && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 ui-caption font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
                        delete marker
                      </span>
                    )}
                    {ver.is_latest && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 ui-caption font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100">
                        latest
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 ui-caption text-slate-500 dark:text-slate-300">
                    {ver.version_id && <span>v: {ver.version_id}</span>}
                    {ver.last_modified && <span>{formatDateTime(ver.last_modified)}</span>}
                    {ver.size != null && <span>{formatBytes(ver.size)}</span>}
                    {ver.etag && <span>ETag {ver.etag}</span>}
                    {ver.storage_class && <span>{ver.storage_class}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!ver.is_delete_marker && (
                    <button
                      type="button"
                      className={bulkActionClasses}
                      onClick={() => onRestoreVersion(ver)}
                    >
                      Restore
                    </button>
                  )}
                  <button
                    type="button"
                    className={bulkDangerClasses}
                    onClick={() => onDeleteVersion(ver)}
                  >
                    {ver.is_delete_marker ? "Delete marker" : "Delete version"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        {(prefixVersionKeyMarker || prefixVersionIdMarker) && (
          <div className="text-right">
            <button
              type="button"
              className={toolbarButtonClasses}
              onClick={onLoadMore}
              disabled={prefixVersionsLoading}
            >
              Load more versions
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

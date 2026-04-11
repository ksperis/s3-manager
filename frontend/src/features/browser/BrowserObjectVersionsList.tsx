/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatBytes } from "../../utils/format";
import { bulkActionClasses, bulkDangerClasses, toolbarButtonClasses } from "./browserConstants";
import { formatDateTime } from "./browserUtils";
import type { BrowserObjectVersion } from "../../api/browser";

type BrowserObjectVersionsListProps = {
  title?: string;
  versions: BrowserObjectVersion[];
  loading: boolean;
  error: string | null;
  emptyLabel?: string;
  containerClassName?: string;
  titleClassName?: string;
  bodyClassName?: string;
  canLoadMore?: boolean;
  onLoadMore?: () => void;
  onRestoreVersion: (version: BrowserObjectVersion) => void;
  onDeleteVersion: (version: BrowserObjectVersion) => void;
};

export default function BrowserObjectVersionsList({
  title = "Versions",
  versions,
  loading,
  error,
  emptyLabel = "No versions found.",
  containerClassName = "space-y-2",
  titleClassName = "ui-caption font-semibold uppercase tracking-wide text-slate-400",
  bodyClassName = "space-y-2",
  canLoadMore = false,
  onLoadMore,
  onRestoreVersion,
  onDeleteVersion,
}: BrowserObjectVersionsListProps) {
  return (
    <div className={containerClassName}>
      <div className="flex items-center justify-between">
        <p className={titleClassName}>{title}</p>
        {loading && <span className="ui-caption text-slate-500 dark:text-slate-400">Loading...</span>}
      </div>
      {error && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{error}</p>}
      <div className={bodyClassName}>
        {versions.length === 0 && !loading && (
          <span className="ui-caption text-slate-500 dark:text-slate-400">{emptyLabel}</span>
        )}
        {versions.map((ver) => (
          <div
            key={`${ver.key}-${ver.version_id ?? "none"}-${ver.is_delete_marker ? "marker" : "version"}`}
            className="rounded-lg border border-slate-200 px-3 py-2 ui-caption text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
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
              <div className="flex flex-wrap items-center gap-2">
                {!ver.is_delete_marker && (
                  <button type="button" className={bulkActionClasses} onClick={() => onRestoreVersion(ver)}>
                    Restore
                  </button>
                )}
                <button type="button" className={bulkDangerClasses} onClick={() => onDeleteVersion(ver)}>
                  {ver.is_delete_marker ? "Delete marker" : "Delete version"}
                </button>
              </div>
            </div>
            <div className="mt-2 space-y-1 ui-caption text-slate-500 dark:text-slate-400">
              {ver.version_id && <div>v: {ver.version_id}</div>}
              {ver.last_modified && <div>Modified: {formatDateTime(ver.last_modified)}</div>}
              {ver.size != null && <div>Size: {formatBytes(ver.size)}</div>}
              {ver.etag && <div>ETag: {ver.etag}</div>}
            </div>
          </div>
        ))}
      </div>
      {canLoadMore && onLoadMore && (
        <button type="button" className={toolbarButtonClasses} onClick={onLoadMore} disabled={loading}>
          Load more versions
        </button>
      )}
    </div>
  );
}

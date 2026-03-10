/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { MultipartUploadItem } from "../../api/browser";
import Modal from "../../components/Modal";
import { bulkDangerClasses, toolbarButtonClasses } from "./browserConstants";
import { formatDateTime } from "./browserUtils";

type BrowserMultipartUploadsModalProps = {
  bucketName: string;
  uploads: MultipartUploadItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  canLoadMore: boolean;
  abortingUploadIds: Set<string>;
  onRefresh: () => void;
  onLoadMore: () => void;
  onAbort: (upload: MultipartUploadItem) => void;
  onClose: () => void;
};

const getUploadRowId = (upload: MultipartUploadItem) => `${upload.key}::${upload.upload_id}`;

export default function BrowserMultipartUploadsModal({
  bucketName,
  uploads,
  loading,
  loadingMore,
  error,
  canLoadMore,
  abortingUploadIds,
  onRefresh,
  onLoadMore,
  onAbort,
  onClose,
}: BrowserMultipartUploadsModalProps) {
  return (
    <Modal title={`Multipart uploads · ${bucketName}`} onClose={onClose} maxWidthClass="max-w-5xl" maxBodyHeightClass="max-h-[75vh]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
          <div className="min-w-0">
            <span className="font-semibold">Bucket {bucketName}</span>
            <p className="text-slate-500 dark:text-slate-400">In-progress multipart uploads.</p>
          </div>
          <div className="flex items-center gap-2">
            {loading && <span className="text-slate-500 dark:text-slate-400">Loading...</span>}
            <button
              type="button"
              className={toolbarButtonClasses}
              onClick={onRefresh}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>

        {error && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{error}</p>}

        {loading && uploads.length === 0 ? (
          <div className="rounded-lg border border-slate-200 px-3 py-4 ui-caption text-slate-500 dark:border-slate-800 dark:text-slate-300">
            Loading multipart uploads...
          </div>
        ) : uploads.length === 0 ? (
          <div className="rounded-lg border border-slate-200 px-3 py-4 ui-caption text-slate-500 dark:border-slate-800 dark:text-slate-300">
            No multipart uploads in progress.
          </div>
        ) : (
          <div className="max-h-[56vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2 text-left">Key</th>
                  <th className="px-3 py-2 text-left">Upload ID</th>
                  <th className="px-3 py-2 text-left">Initiated</th>
                  <th className="px-3 py-2 text-left">Storage class</th>
                  <th className="px-3 py-2 text-left">Owner</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 ui-caption text-slate-700 dark:divide-slate-800 dark:text-slate-200">
                {uploads.map((upload) => {
                  const rowId = getUploadRowId(upload);
                  const aborting = abortingUploadIds.has(rowId);
                  return (
                    <tr key={rowId}>
                      <td className="max-w-[280px] break-all px-3 py-2 font-semibold">{upload.key}</td>
                      <td className="max-w-[260px] break-all px-3 py-2 font-mono text-[11px]">{upload.upload_id}</td>
                      <td className="px-3 py-2">{formatDateTime(upload.initiated)}</td>
                      <td className="px-3 py-2">{upload.storage_class || "-"}</td>
                      <td className="max-w-[200px] truncate px-3 py-2" title={upload.owner || ""}>
                        {upload.owner || "-"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className={bulkDangerClasses}
                          onClick={() => onAbort(upload)}
                          disabled={aborting}
                        >
                          {aborting ? "Aborting..." : "Abort"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {canLoadMore && (
          <div className="text-right">
            <button
              type="button"
              className={toolbarButtonClasses}
              onClick={onLoadMore}
              disabled={loading || loadingMore}
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

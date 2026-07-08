/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { MultipartUploadItem } from "../../api/browser";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import Modal from "../../components/Modal";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
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
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: uploads.length,
  });
  const uploadColumns: Array<DataTableColumn<MultipartUploadItem>> = [
    {
      id: "key",
      label: "Key",
      primary: true,
      cellClassName: "max-w-[280px] break-all",
      render: (upload) => upload.key,
    },
    {
      id: "upload-id",
      label: "Upload ID",
      cellClassName: "max-w-[260px] break-all font-mono text-[11px]",
      render: (upload) => upload.upload_id,
    },
    {
      id: "initiated",
      label: "Initiated",
      render: (upload) => formatDateTime(upload.initiated),
    },
    {
      id: "storage-class",
      label: "Storage class",
      render: (upload) => upload.storage_class || "-",
    },
    {
      id: "owner",
      label: "Owner",
      render: (upload) => (
        <span className="block max-w-[200px] truncate" title={upload.owner || ""}>
          {upload.owner || "-"}
        </span>
      ),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (upload) => {
        const rowId = getUploadRowId(upload);
        const aborting = abortingUploadIds.has(rowId);
        return (
          <button
            type="button"
            className={bulkDangerClasses}
            onClick={() => onAbort(upload)}
            disabled={aborting}
          >
            {aborting ? "Aborting..." : "Abort"}
          </button>
        );
      },
    },
  ];

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

        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}

        <DataTableShell
          columns={uploadColumns}
          rows={uploads}
          rowKey={getUploadRowId}
          status={tableStatus}
          loadingMessage="Loading multipart uploads..."
          errorMessage="Unable to load multipart uploads."
          emptyMessage="No multipart uploads in progress."
          containerClassName="max-h-[56vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800"
          tableClassName="compact-table"
          responsiveCards
        />

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

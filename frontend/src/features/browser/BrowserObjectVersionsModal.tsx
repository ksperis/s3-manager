/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import Modal from "../../components/Modal";
import { toolbarButtonClasses } from "./browserConstants";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";
import type { BrowserObjectVersion } from "../../api/browser";

type BrowserObjectVersionsModalProps = {
  bucketName: string;
  objectKey: string;
  objectPath: string;
  objectVersionsLoading: boolean;
  objectVersionsError: string | null;
  objectVersionRows: BrowserObjectVersion[];
  objectVersionKeyMarker: string | null;
  objectVersionIdMarker: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRestoreVersion: (version: BrowserObjectVersion) => void;
  onDeleteVersion: (version: BrowserObjectVersion) => void;
};

export default function BrowserObjectVersionsModal({
  bucketName,
  objectKey,
  objectPath,
  objectVersionsLoading,
  objectVersionsError,
  objectVersionRows,
  objectVersionKeyMarker,
  objectVersionIdMarker,
  onClose,
  onRefresh,
  onLoadMore,
  onRestoreVersion,
  onDeleteVersion,
}: BrowserObjectVersionsModalProps) {
  return (
    <Modal title={`Object versions · ${objectKey}`} onClose={onClose} maxWidthClass="max-w-4xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
          <div className="min-w-0">
            <span className="font-semibold">Object {objectKey}</span>
            <div className="truncate text-slate-500 dark:text-slate-400">Path: {objectPath}</div>
          </div>
          <div className="flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
            {objectVersionsLoading && <span>Loading...</span>}
            <button
              type="button"
              className={toolbarButtonClasses}
              onClick={onRefresh}
              disabled={!bucketName || objectVersionsLoading}
            >
              Refresh
            </button>
          </div>
        </div>
        <BrowserObjectVersionsList
          title="Versions"
          versions={objectVersionRows}
          loading={objectVersionsLoading}
          error={objectVersionsError}
          canLoadMore={Boolean(objectVersionKeyMarker || objectVersionIdMarker)}
          onLoadMore={onLoadMore}
          onRestoreVersion={onRestoreVersion}
          onDeleteVersion={onDeleteVersion}
        />
      </div>
    </Modal>
  );
}

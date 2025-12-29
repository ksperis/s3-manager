/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type BrowserItem = {
  id: string;
  key: string;
  name: string;
  type: "folder" | "file";
  size: string;
  sizeBytes?: number | null;
  modified: string;
  modifiedAt?: number | null;
  owner: string;
  storageClass?: string;
};

export type TreeNode = {
  id: string;
  name: string;
  prefix: string;
  children: TreeNode[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
};

export type OperationCompletionStatus = "done" | "failed" | "cancelled";

export type OperationItem = {
  id: string;
  label: string;
  path: string;
  progress: number;
  status: "uploading" | "deleting" | "copying" | "downloading";
  sizeBytes?: number;
  kind?: "upload" | "download" | "delete" | "copy" | "other";
  groupId?: string;
  groupLabel?: string;
  groupKind?: "folder" | "files";
  itemLabel?: string;
  cancelable?: boolean;
  completedAt?: string;
  completionStatus?: OperationCompletionStatus;
};

export type UploadCandidate = {
  file: File;
  relativePath?: string;
};

export type UploadQueueItem = {
  id: string;
  file: File;
  relativePath: string;
  key: string;
  bucket: string;
  accountId: string;
  groupId: string;
  groupLabel: string;
  groupKind: "folder" | "files";
  itemLabel: string;
};

export type CompletedOperationItem = {
  id: string;
  label: string;
  path: string;
  when: string;
};

export type DownloadDetailStatus = "queued" | "downloading" | "done" | "failed" | "cancelled";

export type DownloadDetailItem = {
  id: string;
  key: string;
  label: string;
  status: DownloadDetailStatus;
  sizeBytes?: number;
};

export type DeleteDetailStatus = "queued" | "deleting" | "done" | "failed";

export type DeleteDetailItem = {
  id: string;
  key: string;
  label: string;
  status: DeleteDetailStatus;
};

export type CopyDetailStatus = "queued" | "copying" | "done" | "failed";

export type CopyDetailItem = {
  id: string;
  key: string;
  label: string;
  status: CopyDetailStatus;
  sizeBytes?: number;
};

export type SelectionStats = {
  objectCount: number;
  totalBytes: number;
};

export type BulkMetadataDraft = {
  contentType: string;
  cacheControl: string;
  contentDisposition: string;
  contentEncoding: string;
  contentLanguage: string;
  expires: string;
};

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "generic";

export type ContextMenuKind = "item" | "selection" | "path";

export type ContextMenuState = {
  kind: ContextMenuKind;
  x: number;
  y: number;
  item?: BrowserItem | null;
  items?: BrowserItem[];
};

export type ClipboardState = {
  items: BrowserItem[];
  sourceBucket: string;
};

export type WebkitEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error?: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: WebkitEntry[]) => void, error?: (error: unknown) => void) => void;
  };
};

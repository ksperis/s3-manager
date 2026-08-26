/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  buildUploadCandidates,
  buildUploadGrouping,
  collectDroppedFiles,
  makeId,
  normalizePrefix,
  normalizeUploadPath,
} from "./browserUtils";
import type { OperationItem, UploadCandidate, UploadQueueItem } from "./browserTypes";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

type UseBrowserUploadQueueOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  cancelOperationController: OperationRegistry["cancelOperationController"];
  enabled: boolean;
  normalizedPrefix: string;
  onRefreshListing: (prefix: string) => void;
  onShowOperations: () => void;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  operations: OperationItem[];
  parallelism: number;
  prefix: string;
  setUploadQueue: Dispatch<SetStateAction<UploadQueueItem[]>>;
  startUpload: (item: UploadQueueItem) => Promise<boolean>;
  workspaceNoun: string;
};

export function useBrowserUploadQueue({
  accountId,
  bucketName,
  cancelOperationController,
  enabled,
  normalizedPrefix,
  onRefreshListing,
  onShowOperations,
  onStatus,
  onWarning,
  operations,
  parallelism,
  prefix,
  setUploadQueue,
  startUpload,
  workspaceNoun,
}: UseBrowserUploadQueueOptions) {
  const [dragging, setDragging] = useState(false);
  const queueRef = useRef<UploadQueueItem[]>([]);
  const activeUploadsRef = useRef(0);
  const parallelismRef = useRef(parallelism);
  const bucketNameRef = useRef(bucketName);
  const prefixRef = useRef(prefix);
  const refreshListingRef = useRef(onRefreshListing);
  const refreshTimeoutRef = useRef<number | null>(null);
  const pendingUploadedKeysByBucketRef = useRef<Map<string, Set<string>>>(
    new Map(),
  );
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  parallelismRef.current = parallelism;
  bucketNameRef.current = bucketName;
  prefixRef.current = prefix;
  refreshListingRef.current = onRefreshListing;

  useEffect(() => {
    if (!folderInputRef.current) return;
    folderInputRef.current.setAttribute("webkitdirectory", "");
    folderInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const pendingUploadedKeysByBucket =
      pendingUploadedKeysByBucketRef.current;
    return () => {
      mountedRef.current = false;
      queueRef.current = [];
      pendingUploadedKeysByBucket.clear();
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  const updateQueue = useCallback(
    (nextQueue: UploadQueueItem[]) => {
      queueRef.current = nextQueue;
      if (mountedRef.current) setUploadQueue([...nextQueue]);
    },
    [setUploadQueue],
  );

  const recordUploadedKey = useCallback((bucket: string, key: string) => {
    if (!bucket || !key) return;
    const pendingKeys = pendingUploadedKeysByBucketRef.current;
    const existing = pendingKeys.get(bucket);
    if (existing) {
      existing.add(key);
    } else {
      pendingKeys.set(bucket, new Set([key]));
    }
  }, []);

  const flushRefreshIfIdle = useCallback(() => {
    if (typeof window === "undefined" || !mountedRef.current) return;
    if (activeUploadsRef.current > 0 || queueRef.current.length > 0) return;
    if (refreshTimeoutRef.current !== null) return;
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      if (
        !mountedRef.current ||
        activeUploadsRef.current > 0 ||
        queueRef.current.length > 0
      ) {
        return;
      }
      const currentBucket = bucketNameRef.current;
      if (!currentBucket) {
        pendingUploadedKeysByBucketRef.current.clear();
        return;
      }
      const currentPrefix = prefixRef.current;
      const normalizedCurrentPrefix = normalizePrefix(currentPrefix);
      const bucketKeys =
        pendingUploadedKeysByBucketRef.current.get(currentBucket);
      const shouldRefresh = Boolean(
        bucketKeys &&
          Array.from(bucketKeys).some((key) =>
            key.startsWith(normalizedCurrentPrefix),
          ),
      );
      pendingUploadedKeysByBucketRef.current.clear();
      if (shouldRefresh) refreshListingRef.current(currentPrefix);
    }, 300);
  }, []);

  const processQueue: () => void = useCallback(() => {
    const availableSlots = Math.max(
      0,
      parallelismRef.current - activeUploadsRef.current,
    );
    if (availableSlots === 0 || queueRef.current.length === 0) return;
    const nextBatch = queueRef.current.splice(0, availableSlots);
    if (nextBatch.length === 0) return;
    updateQueue(queueRef.current);
    nextBatch.forEach((item) => {
      activeUploadsRef.current += 1;
      startUpload(item)
        .then((uploaded) => {
          if (uploaded) recordUploadedKey(item.bucket, item.key);
        })
        .catch(() => undefined)
        .finally(() => {
          activeUploadsRef.current = Math.max(
            0,
            activeUploadsRef.current - 1,
          );
          processQueue();
          flushRefreshIfIdle();
        });
    });
  }, [flushRefreshIfIdle, recordUploadedKey, startUpload, updateQueue]);

  const addFiles = useCallback(
    (items: UploadCandidate[]) => {
      if (!bucketName || !enabled || !accountId || items.length === 0) return;
      if (items.length > 1) onShowOperations();
      onWarning(null);
      const batchId = makeId();
      const previousQueueCount = queueRef.current.length;
      const availableSlots = Math.max(
        0,
        parallelismRef.current - activeUploadsRef.current,
      );
      const queuedItems = items.map((candidate) => {
        const relativePath = normalizeUploadPath(
          candidate.relativePath || candidate.file.name,
        );
        const grouping = buildUploadGrouping(relativePath, batchId);
        return {
          id: makeId(),
          file: candidate.file,
          relativePath,
          key: `${normalizedPrefix}${relativePath}`,
          bucket: bucketName,
          accountId: String(accountId),
          groupId: grouping.groupId,
          groupLabel: grouping.groupLabel,
          groupKind: grouping.groupKind,
          itemLabel: grouping.itemLabel,
        } satisfies UploadQueueItem;
      });
      const availableForNew = Math.max(
        0,
        availableSlots - previousQueueCount,
      );
      const queuedFromBatch = Math.max(
        0,
        queuedItems.length - availableForNew,
      );
      updateQueue([...queueRef.current, ...queuedItems]);
      processQueue();
      if (queuedFromBatch > 0) {
        onStatus(
          queuedFromBatch === 1
            ? "1 upload queued."
            : `${queuedFromBatch} uploads queued.`,
        );
      }
    },
    [
      accountId,
      bucketName,
      enabled,
      normalizedPrefix,
      onShowOperations,
      onStatus,
      onWarning,
      processQueue,
      updateQueue,
    ],
  );

  const removeQueuedUpload = useCallback(
    (uploadId: string) => {
      updateQueue(queueRef.current.filter((item) => item.id !== uploadId));
    },
    [updateQueue],
  );

  const cancelUploadGroup = useCallback(
    (groupId: string) => {
      updateQueue(queueRef.current.filter((item) => item.groupId !== groupId));
      operations
        .filter(
          (operation) =>
            operation.kind === "upload" &&
            operation.groupId === groupId &&
            !operation.completedAt,
        )
        .forEach((operation) => cancelOperationController(operation.id));
    },
    [cancelOperationController, operations, updateQueue],
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      addFiles(buildUploadCandidates(files));
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [addFiles],
  );

  const handleFolderInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      addFiles(buildUploadCandidates(files));
      if (folderInputRef.current) folderInputRef.current.value = "";
    },
    [addFiles],
  );

  const isFileDrag = (event: DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer?.types || []);
    if (types.includes("Files")) return true;
    return Array.from(event.dataTransfer?.items || []).some(
      (item) => item.kind === "file",
    );
  };

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCounterRef.current += 1;
    setDragging(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!dragging) return;
      event.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setDragging(false);
    },
    [dragging],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragCounterRef.current = 0;
      setDragging(false);
      const files = await collectDroppedFiles(event.dataTransfer);
      if (files.length === 0) return;
      if (!bucketName || !enabled) {
        onStatus(`Select a ${workspaceNoun} before uploading.`);
        return;
      }
      addFiles(files);
    },
    [addFiles, bucketName, enabled, onStatus, workspaceNoun],
  );

  return {
    addFiles,
    cancelUploadGroup,
    dragging,
    fileInputRef,
    folderInputRef,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileInputChange,
    handleFolderInputChange,
    removeQueuedUpload,
  };
}

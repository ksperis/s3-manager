/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  abortMultipartUpload,
  listMultipartUploads,
  type BrowserRequestOptions,
  type MultipartUploadItem,
} from "../../api/browser";
import { extractApiError } from "../../utils/apiError";
import {
  MULTIPART_UPLOADS_HARD_LIMIT,
  MULTIPART_UPLOADS_PAGE_SIZE,
} from "./browserConstants";
import { getMultipartUploadEntryId } from "./browserListingState";

type UseBrowserMultipartUploadsOptions = {
  accountIdForApi: S3AccountSelector;
  bucketName: string;
  hasContext: boolean;
  requestOptions?: BrowserRequestOptions;
  requestConfirmation: (confirmation: {
    title: string;
    message: string;
    confirmLabel: string;
    tone: "danger";
    onConfirm: () => Promise<void>;
  }) => void;
  setStatusMessage: (message: string) => void;
  setWarningMessage: (message: string) => void;
};

export function useBrowserMultipartUploads({
  accountIdForApi,
  bucketName,
  hasContext,
  requestOptions,
  requestConfirmation,
  setStatusMessage,
  setWarningMessage,
}: UseBrowserMultipartUploadsOptions) {
  const [showModal, setShowModal] = useState(false);
  const [uploads, setUploads] = useState<MultipartUploadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [nextUploadId, setNextUploadId] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [abortingUploadIds, setAbortingUploadIds] = useState<Set<string>>(
    new Set(),
  );

  const reset = useCallback(() => {
    setUploads([]);
    setLoading(false);
    setLoadingMore(false);
    setError(null);
    setNextKey(null);
    setNextUploadId(null);
    setIsTruncated(false);
    setAbortingUploadIds(new Set());
  }, []);

  const loadPage = async (options?: {
    append?: boolean;
    keyMarker?: string | null;
    uploadIdMarker?: string | null;
  }) => {
    if (!bucketName || !hasContext) return;
    const append = Boolean(options?.append);
    if (append) {
      if (!isTruncated || loadingMore) return;
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await listMultipartUploads(accountIdForApi, bucketName, {
        keyMarker: append ? (options?.keyMarker ?? undefined) : undefined,
        uploadIdMarker: append
          ? (options?.uploadIdMarker ?? undefined)
          : undefined,
        maxUploads: MULTIPART_UPLOADS_PAGE_SIZE,
        ...requestOptions,
      });
      const baseUploads = append ? uploads : [];
      const knownIds = new Set(
        baseUploads.map((upload) => getMultipartUploadEntryId(upload)),
      );
      const incomingUploads = append
        ? data.uploads.filter(
            (upload) => !knownIds.has(getMultipartUploadEntryId(upload)),
          )
        : data.uploads;
      const mergedUploads = append
        ? [...baseUploads, ...incomingUploads]
        : incomingUploads;
      const limitReached = mergedUploads.length > MULTIPART_UPLOADS_HARD_LIMIT;
      setUploads(mergedUploads.slice(0, MULTIPART_UPLOADS_HARD_LIMIT));
      setError(null);
      if (limitReached) {
        setNextKey(null);
        setNextUploadId(null);
        setIsTruncated(false);
        setWarningMessage(
          `Multipart uploads listing is limited to ${MULTIPART_UPLOADS_HARD_LIMIT.toLocaleString()} entries. Narrow your scope to continue.`,
        );
      } else {
        setNextKey(data.next_key ?? null);
        setNextUploadId(data.next_upload_id ?? null);
        setIsTruncated(Boolean(data.is_truncated));
      }
    } catch (loadError) {
      setError(
        extractApiError(loadError, "Unable to list multipart uploads."),
      );
      if (!append) {
        setUploads([]);
        setNextKey(null);
        setNextUploadId(null);
        setIsTruncated(false);
      }
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  };

  const open = () => {
    if (!bucketName || !hasContext) return;
    setShowModal(true);
    reset();
    void loadPage();
  };

  const refresh = () => {
    if (!bucketName || !hasContext) return;
    void loadPage();
  };

  const loadMore = () => {
    if (!bucketName || !hasContext || !isTruncated) return;
    void loadPage({
      append: true,
      keyMarker: nextKey,
      uploadIdMarker: nextUploadId,
    });
  };

  const abort = async (upload: MultipartUploadItem) => {
    if (!bucketName || !hasContext) return;
    const uploadRowId = getMultipartUploadEntryId(upload);
    setAbortingUploadIds((current) => new Set(current).add(uploadRowId));
    try {
      await abortMultipartUpload(
        accountIdForApi,
        bucketName,
        upload.upload_id,
        upload.key,
        requestOptions,
      );
      setUploads((current) =>
        current.filter(
          (entry) => getMultipartUploadEntryId(entry) !== uploadRowId,
        ),
      );
      setStatusMessage(`Multipart upload aborted for ${upload.key}.`);
    } catch (abortError) {
      const message = extractApiError(
        abortError,
        "Unable to abort multipart upload.",
      );
      setError(message);
      setStatusMessage(message);
    } finally {
      setAbortingUploadIds((current) => {
        const next = new Set(current);
        next.delete(uploadRowId);
        return next;
      });
    }
  };

  const requestAbort = (upload: MultipartUploadItem) => {
    requestConfirmation({
      title: "Abort multipart upload",
      message: `Abort multipart upload for ${upload.key}?`,
      confirmLabel: "Abort",
      tone: "danger",
      onConfirm: () => abort(upload),
    });
  };

  useEffect(() => {
    setShowModal(false);
    reset();
  }, [bucketName, hasContext, reset]);

  return {
    showModal,
    uploads,
    loading,
    loadingMore,
    error,
    canLoadMore: isTruncated && Boolean(nextKey || nextUploadId),
    abortingUploadIds,
    open,
    refresh,
    loadMore,
    close: () => setShowModal(false),
    requestAbort,
  };
}

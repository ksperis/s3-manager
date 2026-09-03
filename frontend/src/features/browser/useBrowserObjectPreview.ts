/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchObjectMetadata,
  type BrowserRequestOptions,
} from "../../api/browser";
import {
  proxyDownload,
  type PresignedUrl,
  type PresignRequest,
} from "../../api/browserTransfers";
import type { ObjectPreviewLoadResult } from "../shared/ObjectPreview";
import { buildInlinePreviewDisposition } from "./browserObjectDetailsModel";

type UseBrowserObjectPreviewOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  metadataContentType?: string | null;
  metadataLoaded: boolean;
  objectKey: string;
  objectName: string;
  presignObjectRequest: (
    targetBucket: string,
    payload: PresignRequest,
  ) => Promise<PresignedUrl>;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64?: string | null;
  useProxyTransfers: boolean;
};

export function useBrowserObjectPreview({
  accountId,
  bucketName,
  metadataContentType,
  metadataLoaded,
  objectKey,
  objectName,
  presignObjectRequest,
  requestOptions,
  sseCustomerKeyBase64,
  useProxyTransfers,
}: UseBrowserObjectPreviewOptions) {
  const loadBlob = useCallback(
    async (signal: AbortSignal): Promise<ObjectPreviewLoadResult> => {
      const previewRequest: PresignRequest = {
        key: objectKey,
        operation: "get_object",
        expires_in: 900,
        response_content_disposition: buildInlinePreviewDisposition(objectName),
      };
      const blob = useProxyTransfers
        ? await proxyDownload(
            accountId,
            bucketName,
            objectKey,
            signal,
            sseCustomerKeyBase64,
            requestOptions,
          )
        : await (async () => {
            const presign = await presignObjectRequest(
              bucketName,
              previewRequest,
            );
            const response = await fetch(presign.url, {
              headers: presign.headers || undefined,
              signal,
            });
            if (!response.ok) throw new Error("Preview download failed.");
            return response.blob();
          })();
      return { blob, contentType: blob.type || null };
    },
    [
      accountId,
      bucketName,
      objectKey,
      objectName,
      presignObjectRequest,
      requestOptions,
      sseCustomerKeyBase64,
      useProxyTransfers,
    ],
  );

  const resolveContentType = useCallback(
    async (signal: AbortSignal) => {
      if (metadataLoaded) return metadataContentType ?? null;
      try {
        const metadata = await fetchObjectMetadata(
          accountId,
          bucketName,
          objectKey,
          null,
          sseCustomerKeyBase64,
          signal,
          requestOptions,
        );
        return metadata.content_type ?? null;
      } catch (error) {
        if (signal.aborted) throw error;
        return null;
      }
    },
    [
      accountId,
      bucketName,
      metadataContentType,
      metadataLoaded,
      objectKey,
      requestOptions,
      sseCustomerKeyBase64,
    ],
  );

  return { loadBlob, resolveContentType };
}

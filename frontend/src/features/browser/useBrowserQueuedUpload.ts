/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  initiateMultipartUpload,
  proxyUpload,
  type BrowserRequestOptions,
  type PresignPartRequest,
  type PresignPartResponse,
  type PresignRequest,
  type PresignedUrl,
  type UploadProgressEvent,
} from "../../api/browser";
import {
  MULTIPART_CONCURRENCY,
  MULTIPART_THRESHOLD,
  PART_SIZE,
} from "./browserConstants";
import { uploadBrowserFile } from "./browserFileUpload";
import { uploadBrowserFileMultipart } from "./browserMultipartUpload";
import { formatBrowserOperationError } from "./browserOperationErrors";
import type { BrowserTransferReporter } from "./browserPageContract";
import type { UploadQueueItem } from "./browserTypes";
import { isAbortError, isLikelyCorsError } from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

type UseBrowserQueuedUploadOptions = {
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  onStatus: (message: string) => void;
  onUploaded: (bucket: string, key: string) => void;
  onWarning: (message: string | null) => void;
  presignObject: (
    bucket: string,
    payload: PresignRequest,
  ) => Promise<PresignedUrl>;
  presignPart: (
    bucket: string,
    uploadId: string,
    payload: PresignPartRequest,
  ) => Promise<PresignPartResponse>;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64: string | null;
  startOperation: OperationRegistry["startOperation"];
  transferReporter?: BrowserTransferReporter;
  updateOperation: OperationRegistry["updateOperation"];
  useProxyTransfers: boolean;
};

export function useBrowserQueuedUpload({
  clearOperationController,
  completeOperation,
  createOperationController,
  onStatus,
  onUploaded,
  onWarning,
  presignObject,
  presignPart,
  requestOptions,
  sseCustomerKeyBase64,
  startOperation,
  transferReporter,
  updateOperation,
  useProxyTransfers,
}: UseBrowserQueuedUploadOptions) {
  return useCallback(
    async (item: UploadQueueItem) => {
      if (!item.bucket || !item.accountId) return;
      const {
        file,
        relativePath,
        key,
        bucket,
        accountId,
        groupId,
        groupLabel,
        groupKind,
        itemLabel,
      } = item;
      const operationId = startOperation(
        "uploading",
        "Uploading",
        `${bucket}/${key}`,
        {
          kind: "upload",
          groupId,
          groupLabel,
          groupKind,
          itemLabel,
          cancelable: true,
          sizeBytes: file.size,
        },
      );
      const controller = createOperationController(operationId);
      const transferId =
        transferReporter?.start({
          direction: "Upload",
          bucketName: bucket,
          key,
          name: itemLabel || relativePath || file.name,
          sizeBytes: file.size,
        }) ?? null;

      try {
        if (!useProxyTransfers && file.size >= MULTIPART_THRESHOLD) {
          updateOperation(operationId, { label: "Multipart upload" });
          await uploadBrowserFileMultipart({
            file,
            partSize: PART_SIZE,
            concurrency: MULTIPART_CONCURRENCY,
            controller,
            lifecycle: {
              initiate: async () => {
                const result = await initiateMultipartUpload(
                  accountId,
                  bucket,
                  {
                    key,
                    content_type: file.type || undefined,
                  },
                  sseCustomerKeyBase64,
                  requestOptions,
                );
                return result.upload_id;
              },
              presignPart: (uploadId, partNumber) =>
                presignPart(bucket, uploadId, {
                  key,
                  part_number: partNumber,
                  expires_in: 1800,
                }),
              complete: (uploadId, parts) =>
                completeMultipartUpload(
                  accountId,
                  bucket,
                  uploadId,
                  key,
                  { parts },
                  requestOptions,
                ),
              abort: (uploadId) =>
                abortMultipartUpload(
                  accountId,
                  bucket,
                  uploadId,
                  key,
                  requestOptions,
                ),
            },
            onProgress: (progress) => {
              updateOperation(operationId, { progress });
            },
          });
        } else {
          const onProgress = (event: UploadProgressEvent) => {
            const total = event.total ?? file.size;
            const progress = total
              ? Math.round((event.loaded / total) * 100)
              : 0;
            updateOperation(operationId, { progress });
          };
          await uploadBrowserFile({
            file,
            mode: useProxyTransfers ? "proxy" : "direct",
            signal: controller.signal,
            onProgress,
            uploadProxy: () =>
              proxyUpload(
                accountId,
                bucket,
                key,
                file,
                onProgress,
                controller.signal,
                sseCustomerKeyBase64,
                undefined,
                requestOptions,
              ),
            presign: () =>
              presignObject(bucket, {
                key,
                operation: "put_object",
                content_type: file.type || undefined,
                expires_in: 1800,
              }),
          });
        }
        completeOperation(operationId, "done");
        if (transferId) {
          transferReporter?.complete(
            transferId,
            itemLabel || relativePath || file.name,
          );
        }
        onStatus(`Uploaded ${relativePath}`);
        onUploaded(bucket, key);
      } catch (caughtError) {
        if (isAbortError(caughtError)) {
          completeOperation(operationId, "cancelled");
          const message = `Upload cancelled for ${relativePath}`;
          if (transferId) transferReporter?.fail(transferId, message);
          onStatus(message);
        } else {
          const completionError = formatBrowserOperationError(
            caughtError,
            `Upload failed for ${relativePath}`,
            `Upload failed for ${relativePath}`,
          );
          completeOperation(operationId, "failed", completionError);
          if (transferId) transferReporter?.fail(transferId, completionError);
          onStatus(completionError);
          if (!useProxyTransfers && isLikelyCorsError(caughtError)) {
            onWarning(
              "Direct transfer failed before S3 returned an HTTP response. Possible causes: network reachability, TLS/certificate issue, CORS policy, or endpoint/proxy configuration.",
            );
          }
        }
      } finally {
        clearOperationController(operationId);
      }
    },
    [
      clearOperationController,
      completeOperation,
      createOperationController,
      onStatus,
      onUploaded,
      onWarning,
      presignObject,
      presignPart,
      requestOptions,
      sseCustomerKeyBase64,
      startOperation,
      transferReporter,
      updateOperation,
      useProxyTransfers,
    ],
  );
}

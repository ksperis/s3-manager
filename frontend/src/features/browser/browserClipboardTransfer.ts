/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "../../api/accountParams";
import { MULTIPART_THRESHOLD } from "./browserConstants";

export type ClipboardTransferMode = "direct" | "proxy";

type ClipboardTransferObjectRef = {
  selector: S3AccountSelector;
  bucket: string;
  key: string;
  sseCustomerKeyBase64?: string | null;
};

type ClipboardTransferDownloadRef = ClipboardTransferObjectRef & {
  mode: ClipboardTransferMode;
  signal?: AbortSignal;
};

type ClipboardTransferUploadBlobRef = ClipboardTransferObjectRef & {
  mode: ClipboardTransferMode;
  blob: Blob;
  contentType?: string | null;
  signal?: AbortSignal;
};

type ClipboardTransferUploadStreamRef = ClipboardTransferObjectRef & {
  stream: ReadableStream<Uint8Array>;
  sizeBytes: number;
  contentType?: string | null;
  signal?: AbortSignal;
};

export type TransferClipboardObjectParams = {
  source: ClipboardTransferObjectRef;
  destination: ClipboardTransferObjectRef;
  sizeBytes: number;
  contentType?: string | null;
  move?: boolean;
  signal?: AbortSignal;
  multipartThresholdBytes?: number;
  resolveMode: (
    selector: S3AccountSelector,
    bucket: string,
  ) => Promise<ClipboardTransferMode>;
  downloadBlob: (params: ClipboardTransferDownloadRef) => Promise<Blob>;
  downloadStream: (
    params: ClipboardTransferDownloadRef,
  ) => Promise<ReadableStream<Uint8Array>>;
  uploadBlob: (params: ClipboardTransferUploadBlobRef) => Promise<void>;
  uploadMultipartStream: (
    params: ClipboardTransferUploadStreamRef,
  ) => Promise<void>;
  verifyObject: (
    params: ClipboardTransferObjectRef,
  ) => Promise<{ sizeBytes: number }>;
  deleteObject: (params: ClipboardTransferObjectRef) => Promise<void>;
};

export async function transferClipboardObjectBetweenContexts({
  source,
  destination,
  sizeBytes,
  contentType,
  move = false,
  signal,
  multipartThresholdBytes = MULTIPART_THRESHOLD,
  resolveMode,
  downloadBlob,
  downloadStream,
  uploadBlob,
  uploadMultipartStream,
  verifyObject,
  deleteObject,
}: TransferClipboardObjectParams): Promise<void> {
  const sourceMode = await resolveMode(source.selector, source.bucket);
  const destinationMode = await resolveMode(
    destination.selector,
    destination.bucket,
  );

  const shouldUseMultipart =
    destinationMode === "direct" && sizeBytes >= multipartThresholdBytes;

  if (shouldUseMultipart) {
    const stream = await downloadStream({
      ...source,
      mode: sourceMode,
      signal,
    });
    await uploadMultipartStream({
      ...destination,
      stream,
      sizeBytes,
      contentType,
      signal,
    });
  } else {
    const blob = await downloadBlob({
      ...source,
      mode: sourceMode,
      signal,
    });
    await uploadBlob({
      ...destination,
      mode: destinationMode,
      blob,
      contentType,
      signal,
    });
  }

  if (!move) {
    return;
  }

  const verified = await verifyObject(destination);
  if (verified.sizeBytes !== sizeBytes) {
    throw new Error(
      `Copy verification failed for '${destination.key}' (size mismatch).`,
    );
  }

  await deleteObject(source);
}

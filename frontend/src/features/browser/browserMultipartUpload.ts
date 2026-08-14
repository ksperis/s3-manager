/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { runWithConcurrency } from "../../utils/concurrency";
import { normalizeEtag } from "./browserUtils";

type CompletedPart = { part_number: number; etag: string };

type PresignedPart = {
  url: string;
  headers?: Record<string, string>;
};

export type BrowserMultipartUploadLifecycle = {
  initiate: () => Promise<string>;
  presignPart: (
    uploadId: string,
    partNumber: number,
  ) => Promise<PresignedPart>;
  complete: (uploadId: string, parts: CompletedPart[]) => Promise<void>;
  abort: (uploadId: string) => Promise<void>;
};

type UploadFileMultipartParams = {
  file: File;
  partSize: number;
  concurrency: number;
  controller: AbortController;
  lifecycle: BrowserMultipartUploadLifecycle;
  onProgress: (percent: number) => void;
};

type UploadStreamMultipartParams = {
  stream: ReadableStream<Uint8Array>;
  sizeBytes: number;
  contentType?: string | null;
  partSize: number;
  signal?: AbortSignal;
  lifecycle: BrowserMultipartUploadLifecycle;
};

const abortStartedUpload = async (
  uploadId: string | null,
  lifecycle: BrowserMultipartUploadLifecycle,
): Promise<void> => {
  if (!uploadId) return;
  try {
    await lifecycle.abort(uploadId);
  } catch {
    // The original upload error is more useful than a best-effort cleanup error.
  }
};

export const uploadBrowserFileMultipart = async ({
  file,
  partSize,
  concurrency,
  controller,
  lifecycle,
  onProgress,
}: UploadFileMultipartParams): Promise<void> => {
  let uploadId: string | null = null;
  const partProgress = new Map<number, number>();
  const totalParts = Math.ceil(file.size / partSize);
  const parts = Array.from({ length: totalParts }, (_, index) => {
    const partNumber = index + 1;
    const start = index * partSize;
    const end = Math.min(start + partSize, file.size);
    return { partNumber, start, end, size: end - start };
  });
  const completedParts: CompletedPart[] = [];

  const recordProgress = (
    partNumber: number,
    loadedBytes: number,
    currentPartSize: number,
  ) => {
    partProgress.set(
      partNumber,
      Math.min(loadedBytes, currentPartSize),
    );
    const loaded = Array.from(partProgress.values()).reduce(
      (sum, value) => sum + value,
      0,
    );
    onProgress(
      file.size ? Math.min(99, Math.round((loaded / file.size) * 100)) : 0,
    );
  };

  try {
    const startedUploadId = await lifecycle.initiate();
    uploadId = startedUploadId;
    let failed = false;
    await runWithConcurrency(
      parts,
      concurrency,
      async (part) => {
        try {
          const presignedPart = await lifecycle.presignPart(
            startedUploadId,
            part.partNumber,
          );
          recordProgress(part.partNumber, 0, part.size);
          const response = await fetch(presignedPart.url, {
            method: "PUT",
            headers: presignedPart.headers || {},
            body: file.slice(part.start, part.end),
            credentials: "omit",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Multipart upload failed with status ${response.status}`);
          const etag = normalizeEtag(response.headers.get("etag") ?? undefined);
          if (!etag) {
            throw new Error("Missing ETag from multipart upload.");
          }
          completedParts.push({ part_number: part.partNumber, etag });
          recordProgress(part.partNumber, part.size, part.size);
        } catch (error) {
          failed = true;
          controller.abort();
          throw error;
        }
      },
      () => failed,
    );
    onProgress(95);
    completedParts.sort((left, right) => left.part_number - right.part_number);
    await lifecycle.complete(startedUploadId, completedParts);
    onProgress(100);
  } catch (error) {
    await abortStartedUpload(uploadId, lifecycle);
    throw error;
  }
};

export const uploadBrowserStreamMultipart = async ({
  stream,
  sizeBytes,
  contentType,
  partSize,
  signal,
  lifecycle,
}: UploadStreamMultipartParams): Promise<void> => {
  let uploadId: string | null = null;
  const completedParts: CompletedPart[] = [];
  const reader = stream.getReader();
  let pending = new Uint8Array(0);
  let partNumber = 1;

  const flushPart = async (partBytes: Uint8Array) => {
    if (!uploadId) {
      throw new Error("Missing multipart upload ID.");
    }
    const currentPartNumber = partNumber;
    const presignedPart = await lifecycle.presignPart(
      uploadId,
      currentPartNumber,
    );
    const partBuffer = new Uint8Array(partBytes).buffer;
    const response = await fetch(presignedPart.url, {
      method: "PUT",
      headers: presignedPart.headers || {},
      body: new Blob([partBuffer], {
        type: contentType || "application/octet-stream",
      }),
      credentials: "omit",
      signal,
    });
    if (!response.ok) throw new Error(`Multipart upload failed with status ${response.status}`);
    const etag = normalizeEtag(response.headers.get("etag") ?? undefined);
    if (!etag) {
      throw new Error("Missing ETag from multipart upload.");
    }
    completedParts.push({ part_number: currentPartNumber, etag });
    partNumber += 1;
  };

  try {
    const startedUploadId = await lifecycle.initiate();
    uploadId = startedUploadId;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const combined = new Uint8Array(pending.byteLength + value.byteLength);
      combined.set(pending, 0);
      combined.set(value, pending.byteLength);
      pending = combined;

      while (pending.byteLength >= partSize) {
        await flushPart(pending.slice(0, partSize));
        pending = pending.slice(partSize);
      }
    }

    if (pending.byteLength > 0 || sizeBytes === 0) {
      await flushPart(pending);
    }
    completedParts.sort((left, right) => left.part_number - right.part_number);
    await lifecycle.complete(startedUploadId, completedParts);
  } catch (error) {
    await abortStartedUpload(uploadId, lifecycle);
    throw error;
  } finally {
    reader.releaseLock();
  }
};

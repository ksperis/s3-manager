/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ZipWriter } from "@zip.js/zip.js";
import JSZip from "jszip";

import type { BrowserObject } from "../../api/browser";
import { triggerBlobDownload } from "../../utils/download";
import { formatBrowserOperationError } from "./browserOperationErrors";
import type { DownloadDetailStatus } from "./browserTypes";
import { isAbortError } from "./browserUtils";

type BrowserFolderDownloadTarget = {
  detailId: string;
  key: string;
  relativeKey: string;
  sizeBytes: number;
};

type BrowserFolderDownloadPlan = {
  targets: BrowserFolderDownloadTarget[];
  totalBytes: number;
};

type WritableFileStream = WritableStream<Uint8Array> & {
  abort?: () => Promise<void>;
};

type SaveFilePicker = (options?: unknown) => Promise<{
  createWritable: () => Promise<WritableStream<Uint8Array>>;
}>;

type BrowserFolderArchiveOptions = {
  controller: AbortController;
  downloadBlob: (key: string, signal: AbortSignal) => Promise<Blob>;
  downloadStream: (
    key: string,
    signal: AbortSignal,
  ) => Promise<ReadableStream<Uint8Array>>;
  folderLabel: string;
  onDetailChange: (
    detailId: string,
    status: DownloadDetailStatus,
    errorMessage?: string,
  ) => void;
  onPhaseChange: (label: "Streaming zip" | "Packaging zip") => void;
  onProgress: (percent: number) => void;
  parallelism: number;
  saveFilePicker?: SaveFilePicker;
  streamingThresholdBytes: number;
  targets: BrowserFolderDownloadTarget[];
  totalBytes: number;
};

type BrowserFolderArchiveResult = {
  cancelled: boolean;
  failedKeys: string[];
};

export const resolveBrowserFolderArchiveLabel = (
  name: string | undefined,
  prefix: string,
): string => {
  const rawLabel = name || prefix.replace(/\/$/, "") || "folder";
  return rawLabel.replace(/[\\/]/g, "-") || "folder";
};

export const buildBrowserFolderDownloadPlan = (
  objects: BrowserObject[],
  folderPrefix: string,
  makeDetailId: () => string,
): BrowserFolderDownloadPlan => {
  const targets = objects.flatMap((object) => {
    const relativeKey = object.key.startsWith(folderPrefix)
      ? object.key.slice(folderPrefix.length)
      : object.key;
    if (!relativeKey || (relativeKey.endsWith("/") && object.size === 0)) {
      return [];
    }
    return [
      {
        detailId: makeDetailId(),
        key: object.key,
        relativeKey,
        sizeBytes: object.size,
      },
    ];
  });
  return {
    targets,
    totalBytes: targets.reduce((sum, target) => sum + target.sizeBytes, 0),
  };
};

const defaultSaveFilePicker = (): SaveFilePicker | undefined =>
  typeof window === "undefined"
    ? undefined
    : (
        window as Window & {
          showSaveFilePicker?: SaveFilePicker;
        }
      ).showSaveFilePicker;

export const downloadBrowserFolderArchive = async ({
  controller,
  downloadBlob,
  downloadStream,
  folderLabel,
  onDetailChange,
  onPhaseChange,
  onProgress,
  parallelism,
  saveFilePicker = defaultSaveFilePicker(),
  streamingThresholdBytes,
  targets,
  totalBytes,
}: BrowserFolderArchiveOptions): Promise<BrowserFolderArchiveResult> => {
  const totalCount = targets.length;
  let downloadedBytes = 0;
  let completed = 0;
  let aborted = false;
  const failedKeys: string[] = [];

  const updateTransferProgress = () => {
    const base =
      totalBytes > 0 ? downloadedBytes / totalBytes : completed / totalCount;
    onProgress(Math.min(80, Math.round(base * 80)));
  };
  const supportsStreamingZip = Boolean(
    saveFilePicker &&
      typeof ReadableStream !== "undefined" &&
      typeof WritableStream !== "undefined" &&
      typeof TransformStream !== "undefined",
  );
  const shouldStreamZip =
    supportsStreamingZip && totalBytes >= streamingThresholdBytes;

  if (shouldStreamZip && saveFilePicker) {
    let fileStream: WritableFileStream | null = null;
    let zipWriter: ZipWriter<Uint8Array> | null = null;
    try {
      const handle = await saveFilePicker({
        suggestedName: `${folderLabel}.zip`,
        types: [
          {
            description: "ZIP archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      fileStream = (await handle.createWritable()) as WritableFileStream;
      zipWriter = new ZipWriter(fileStream);
    } catch (error) {
      if (isAbortError(error)) {
        return { cancelled: true, failedKeys };
      }
      throw error;
    }

    onPhaseChange("Streaming zip");
    for (const target of targets) {
      if (controller.signal.aborted) {
        aborted = true;
        break;
      }
      onDetailChange(target.detailId, "downloading");
      try {
        const stream = await downloadStream(target.key, controller.signal);
        const counter = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, streamController) {
            downloadedBytes += chunk.byteLength;
            updateTransferProgress();
            streamController.enqueue(chunk);
          },
        });
        await zipWriter.add(
          `${folderLabel}/${target.relativeKey}`,
          stream.pipeThrough(counter),
        );
        onDetailChange(target.detailId, "done");
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          onDetailChange(target.detailId, "cancelled");
          aborted = true;
          controller.abort();
          break;
        }
        console.error(error);
        onDetailChange(
          target.detailId,
          "failed",
          formatBrowserOperationError(error, "Download failed."),
        );
        failedKeys.push(target.key);
      } finally {
        completed += 1;
        if (totalBytes <= 0) updateTransferProgress();
      }
    }

    if (aborted || controller.signal.aborted) {
      if (fileStream.abort) await fileStream.abort();
      return { cancelled: true, failedKeys };
    }
    await zipWriter.close();
    onProgress(100);
    return { cancelled: false, failedKeys };
  }

  const zip = new JSZip();
  const queue = [...targets];
  const normalizedParallelism = Number.isFinite(parallelism)
    ? Math.max(1, Math.floor(parallelism))
    : 1;
  const workerCount = Math.max(
    1,
    Math.min(normalizedParallelism, queue.length),
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0 && !aborted) {
      if (controller.signal.aborted) {
        aborted = true;
        return;
      }
      const target = queue.shift();
      if (!target) return;
      onDetailChange(target.detailId, "downloading");
      try {
        const blob = await downloadBlob(target.key, controller.signal);
        zip.file(`${folderLabel}/${target.relativeKey}`, blob);
        onDetailChange(target.detailId, "done");
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          onDetailChange(target.detailId, "cancelled");
          aborted = true;
          controller.abort();
          return;
        }
        console.error(error);
        onDetailChange(
          target.detailId,
          "failed",
          formatBrowserOperationError(error, "Download failed."),
        );
        failedKeys.push(target.key);
      } finally {
        completed += 1;
        downloadedBytes += target.sizeBytes;
        updateTransferProgress();
      }
    }
  });
  await Promise.all(workers);

  if (aborted || controller.signal.aborted) {
    return { cancelled: true, failedKeys };
  }
  onPhaseChange("Packaging zip");
  const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
    onProgress(Math.min(99, 80 + Math.round(metadata.percent * 0.2)));
  });
  if (controller.signal.aborted) {
    return { cancelled: true, failedKeys };
  }
  onProgress(100);
  triggerBlobDownload(`${folderLabel}.zip`, zipBlob);
  return { cancelled: false, failedKeys };
};

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import {
  normalizeS3AccountSelectorId,
  type S3AccountSelector,
} from "../../api/accountParams";
import {
  copyObject,
  createFolder,
  deleteObjects,
  fetchObjectMetadata,
  getBucketCorsStatus,
  type BrowserRequestOptions,
} from "../../api/browser";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  initiateMultipartUpload,
  presignPart,
} from "../../api/browserMultipart";
import { runWithConcurrency } from "../../utils/concurrency";
import type { BrowserFunctionalProfile } from "./browserActions";
import { PART_SIZE } from "./browserConstants";
import {
  transferClipboardObjectBetweenContexts,
  type ClipboardTransferMode,
} from "./browserClipboardTransfer";
import { formatBrowserOperationError } from "./browserOperationErrors";
import { updateOperationDetailById } from "./browserOperationDetailState";
import { resolveBrowserCorsAvailability } from "./browserTransferPresentation";
import {
  downloadBrowserTransferBlob,
  downloadBrowserTransferStream,
  uploadBrowserTransferBlob,
} from "./browserObjectTransferTransport";
import { uploadBrowserStreamMultipart } from "./browserMultipartUpload";
import type {
  BrowserItem,
  ClipboardState,
  CopyDetailItem,
  CopyDetailStatus,
} from "./browserTypes";
import {
  isAbortError,
  makeId,
  normalizePrefix,
  shortName,
} from "./browserUtils";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;
type ClipboardTransferParameters = Parameters<
  typeof transferClipboardObjectBetweenContexts
>[0];

type UseBrowserClipboardOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  cancelCopyDetails: OperationRegistry["cancelCopyDetails"];
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  enabled: boolean;
  functionalProfile: BrowserFunctionalProfile;
  getSseCustomerKeyForScope: (
    selector: S3AccountSelector,
    bucket: string,
  ) => string | null;
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  normalizedPrefix: string;
  onRefreshNow: (prefix: string) => Promise<void>;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  parallelism: number;
  proxyAllowed: boolean;
  requestOptions?: BrowserRequestOptions;
  setCopyDetails: OperationRegistry["setCopyDetails"];
  showOperations: () => void;
  startOperation: OperationRegistry["startOperation"];
  uiOrigin?: string;
  updateOperation: OperationRegistry["updateOperation"];
};

export function useBrowserClipboard({
  accountId,
  bucketName,
  cancelCopyDetails,
  clearOperationController,
  completeOperation,
  createOperationController,
  enabled,
  functionalProfile,
  getSseCustomerKeyForScope,
  listAllObjectsForPrefix,
  normalizedPrefix,
  onRefreshNow,
  onStatus,
  onWarning,
  parallelism,
  proxyAllowed,
  requestOptions,
  setCopyDetails,
  showOperations,
  startOperation,
  uiOrigin,
  updateOperation,
}: UseBrowserClipboardOptions) {
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const currentAccountId = normalizeS3AccountSelectorId(accountId);
  const clipboardAccountId = normalizeS3AccountSelectorId(
    clipboard?.sourceSelector ?? null,
  );
  const clipboardMatchesContext = Boolean(
    clipboard && clipboardAccountId === currentAccountId,
  );
  const canPaste = Boolean(clipboard && bucketName && enabled);
  const canPasteInFunctionalProfile =
    canPaste &&
    (functionalProfile === "advanced" || clipboardMatchesContext);

  const copy = useCallback(
    (items: BrowserItem[]) => {
      if (!bucketName || items.length === 0) return;
      const eligibleItems = items.filter((item) => !item.isDeleted);
      if (eligibleItems.length === 0) {
        onWarning("Deleted objects cannot be copied directly.");
        return;
      }
      onWarning(
        eligibleItems.length !== items.length
          ? "Deleted objects were skipped."
          : null,
      );
      setClipboard({
        items: eligibleItems,
        sourceBucket: bucketName,
        sourceSelector: accountId ?? null,
        mode: "copy",
      });
      onStatus("Items copied.");
    },
    [accountId, bucketName, onStatus, onWarning],
  );

  const cut = useCallback(
    (items: BrowserItem[]) => {
      if (!bucketName || items.length === 0) return;
      const eligibleItems = items.filter((item) => !item.isDeleted);
      if (eligibleItems.length === 0) {
        onWarning("Deleted objects cannot be moved directly.");
        return;
      }
      onWarning(
        eligibleItems.length !== items.length
          ? "Deleted objects were skipped."
          : null,
      );
      setClipboard({
        items: eligibleItems,
        sourceBucket: bucketName,
        sourceSelector: accountId ?? null,
        mode: "move",
      });
      onStatus("Items ready to move.");
    },
    [accountId, bucketName, onStatus, onWarning],
  );

  const resolveTransferMode = useCallback(
    async (
      selector: S3AccountSelector,
      targetBucket: string,
    ): Promise<ClipboardTransferMode> => {
      try {
        const status = await getBucketCorsStatus(
          selector,
          targetBucket,
          uiOrigin,
          requestOptions,
        );
        if (resolveBrowserCorsAvailability(status) !== "disabled") {
          return "direct";
        }
      } catch {
        return "direct";
      }
      if (proxyAllowed) return "proxy";
      throw new Error(
        `Direct transfer is unavailable for ${targetBucket} and proxy transfers are disabled.`,
      );
    },
    [proxyAllowed, requestOptions, uiOrigin],
  );

  const downloadBlob = useCallback<
    ClipboardTransferParameters["downloadBlob"]
  >(
    (parameters) =>
      downloadBrowserTransferBlob({
        ...parameters,
        options: requestOptions,
      }),
    [requestOptions],
  );

  const downloadStream = useCallback<
    ClipboardTransferParameters["downloadStream"]
  >(
    (parameters) =>
      downloadBrowserTransferStream({
        ...parameters,
        options: requestOptions,
      }),
    [requestOptions],
  );

  const uploadBlob = useCallback<ClipboardTransferParameters["uploadBlob"]>(
    (parameters) =>
      uploadBrowserTransferBlob({
        ...parameters,
        options: requestOptions,
      }),
    [requestOptions],
  );

  const uploadMultipartStream = useCallback<
    ClipboardTransferParameters["uploadMultipartStream"]
  >(
    async ({
      selector,
      bucket,
      key,
      stream,
      sizeBytes,
      contentType,
      sseCustomerKeyBase64,
      signal,
    }) => {
      await uploadBrowserStreamMultipart({
        stream,
        sizeBytes,
        contentType,
        partSize: PART_SIZE,
        signal,
        lifecycle: {
          initiate: async () => {
            const result = await initiateMultipartUpload(
              selector,
              bucket,
              { key, content_type: contentType ?? undefined },
              sseCustomerKeyBase64,
              requestOptions,
            );
            return result.upload_id;
          },
          presignPart: (uploadId, partNumber) =>
            presignPart(
              selector,
              bucket,
              uploadId,
              { key, part_number: partNumber, expires_in: 1800 },
              sseCustomerKeyBase64,
              requestOptions,
            ),
          complete: (uploadId, parts) =>
            completeMultipartUpload(
              selector,
              bucket,
              uploadId,
              key,
              { parts },
              requestOptions,
            ),
          abort: (uploadId) =>
            abortMultipartUpload(
              selector,
              bucket,
              uploadId,
              key,
              requestOptions,
            ),
        },
      });
    },
    [requestOptions],
  );

  const deleteObject = useCallback<ClipboardTransferParameters["deleteObject"]>(
    async ({ selector, bucket, key }) => {
      await deleteObjects(selector, bucket, [{ key }], undefined, requestOptions);
    },
    [requestOptions],
  );

  const updateCopyDetailStatus = useCallback(
    (
      operationId: string,
      detailId: string,
      status: CopyDetailStatus,
      errorMessage?: string,
    ) => {
      setCopyDetails((previous) =>
        updateOperationDetailById(
          previous,
          operationId,
          detailId,
          status,
          errorMessage,
        ),
      );
    },
    [setCopyDetails],
  );

  const paste = useCallback(async () => {
    if (!clipboard || !bucketName || !enabled) return;
    if (functionalProfile !== "advanced" && !clipboardMatchesContext) {
      onWarning(
        "Cross-context copy and move require the Advanced Browser profile.",
      );
      return;
    }
    onWarning(null);
    const destinationBucket = bucketName;
    const destinationPrefix = normalizedPrefix;
    const { items, sourceBucket, sourceSelector, mode } = clipboard;
    const isMove = mode === "move";
    const useServerSideCopy = clipboardMatchesContext;
    const copyTasks: Array<{
      sourceSelector: S3AccountSelector;
      sourceBucket: string;
      sourceKey: string;
      destinationBucket: string;
      destinationKey: string;
      detailId: string;
    }> = [];
    const copyDetailItems: CopyDetailItem[] = [];
    let skipped = 0;

    for (const item of items) {
      if (item.type === "file") {
        const destinationKey = `${destinationPrefix}${item.name}`;
        if (
          useServerSideCopy &&
          sourceBucket === destinationBucket &&
          destinationKey === item.key
        ) {
          skipped += 1;
          continue;
        }
        const detailId = makeId();
        copyTasks.push({
          sourceSelector,
          sourceBucket,
          sourceKey: item.key,
          destinationBucket,
          destinationKey,
          detailId,
        });
        copyDetailItems.push({
          id: detailId,
          key: destinationKey,
          label: shortName(destinationKey, destinationPrefix) || destinationKey,
          status: "queued",
          sizeBytes: item.sizeBytes ?? undefined,
        });
        continue;
      }

      const sourcePrefix = normalizePrefix(item.key);
      const destinationFolderPrefix = `${destinationPrefix}${item.name}/`;
      if (
        useServerSideCopy &&
        sourceBucket === destinationBucket &&
        destinationFolderPrefix === sourcePrefix
      ) {
        skipped += 1;
        continue;
      }
      try {
        await createFolder(accountId, destinationBucket, destinationFolderPrefix);
      } catch {
        // Object copies below still create the effective S3 prefix.
      }
      const objects = await listAllObjectsForPrefix(
        sourcePrefix,
        sourceBucket,
        sourceSelector,
      );
      objects.forEach((object) => {
        const relativeKey = object.key.startsWith(sourcePrefix)
          ? object.key.slice(sourcePrefix.length)
          : object.key;
        if (!relativeKey) return;
        const destinationKey = `${destinationFolderPrefix}${relativeKey}`;
        if (
          useServerSideCopy &&
          sourceBucket === destinationBucket &&
          destinationKey === object.key
        ) {
          skipped += 1;
          return;
        }
        const detailId = makeId();
        copyTasks.push({
          sourceSelector,
          sourceBucket,
          sourceKey: object.key,
          destinationBucket,
          destinationKey,
          detailId,
        });
        copyDetailItems.push({
          id: detailId,
          key: destinationKey,
          label: shortName(destinationKey, destinationPrefix) || destinationKey,
          status: "queued",
          sizeBytes: object.size ?? undefined,
        });
      });
    }

    if (copyTasks.length === 0) {
      onStatus(skipped > 0 ? "Nothing new to paste here." : "No items to paste.");
      return;
    }

    if (copyTasks.length > 1) showOperations();
    const operationId = startOperation(
      "copying",
      isMove ? "Moving items" : "Copying items",
      destinationPrefix
        ? `${destinationBucket}/${destinationPrefix}`
        : destinationBucket,
      { kind: "copy", cancelable: true },
      0,
    );
    const controller = createOperationController(operationId);
    setCopyDetails((previous) => ({
      ...previous,
      [operationId]: copyDetailItems,
    }));
    const total = copyTasks.length;
    let completed = 0;
    let succeeded = 0;
    let failures = 0;
    let cancelled = false;
    const updateProgress = () => {
      const progress = total > 0 ? Math.round((completed / total) * 100) : 100;
      updateOperation(operationId, { progress });
    };

    try {
      const transferModeCache = new Map<
        string,
        Promise<ClipboardTransferMode>
      >();
      const resolveTransferModeCached = (
        selector: S3AccountSelector,
        targetBucket: string,
      ) => {
        const cacheKey = `${normalizeS3AccountSelectorId(selector) ?? ""}::${targetBucket}`;
        const cached = transferModeCache.get(cacheKey);
        if (cached) return cached;
        const request = resolveTransferMode(selector, targetBucket);
        transferModeCache.set(cacheKey, request);
        return request;
      };

      await runWithConcurrency(
        copyTasks,
        parallelism,
        async (task) => {
          if (controller.signal.aborted) {
            cancelled = true;
            return;
          }
          try {
            updateCopyDetailStatus(operationId, task.detailId, "copying");
            if (useServerSideCopy) {
              await copyObject(
                accountId,
                destinationBucket,
                {
                  source_bucket: task.sourceBucket,
                  source_key: task.sourceKey,
                  destination_key: task.destinationKey,
                  move: isMove,
                },
                controller.signal,
                requestOptions,
              );
            } else {
              const sourceSseCustomerKeyBase64 = getSseCustomerKeyForScope(
                task.sourceSelector,
                task.sourceBucket,
              );
              const destinationSseCustomerKeyBase64 =
                getSseCustomerKeyForScope(accountId, destinationBucket);
              const sourceMetadata = await fetchObjectMetadata(
                task.sourceSelector,
                task.sourceBucket,
                task.sourceKey,
                null,
                sourceSseCustomerKeyBase64,
                controller.signal,
                requestOptions,
              );
              await transferClipboardObjectBetweenContexts({
                source: {
                  selector: task.sourceSelector,
                  bucket: task.sourceBucket,
                  key: task.sourceKey,
                  sseCustomerKeyBase64: sourceSseCustomerKeyBase64,
                },
                destination: {
                  selector: accountId,
                  bucket: destinationBucket,
                  key: task.destinationKey,
                  sseCustomerKeyBase64: destinationSseCustomerKeyBase64,
                },
                sizeBytes: sourceMetadata.size,
                contentType: sourceMetadata.content_type ?? undefined,
                move: isMove,
                signal: controller.signal,
                resolveMode: resolveTransferModeCached,
                downloadBlob,
                downloadStream,
                uploadBlob,
                uploadMultipartStream,
                verifyObject: async ({
                  selector,
                  bucket,
                  key,
                  sseCustomerKeyBase64,
                }) => {
                  const metadata = await fetchObjectMetadata(
                    selector,
                    bucket,
                    key,
                    null,
                    sseCustomerKeyBase64,
                    controller.signal,
                    requestOptions,
                  );
                  return { sizeBytes: metadata.size };
                },
                deleteObject,
              });
            }
            updateCopyDetailStatus(operationId, task.detailId, "done");
            succeeded += 1;
          } catch (caughtError) {
            if (isAbortError(caughtError) || controller.signal.aborted) {
              cancelled = true;
              controller.abort();
              updateCopyDetailStatus(
                operationId,
                task.detailId,
                "cancelled",
              );
              return;
            }
            updateCopyDetailStatus(
              operationId,
              task.detailId,
              "failed",
              formatBrowserOperationError(caughtError, "Copy failed."),
            );
            failures += 1;
          } finally {
            completed += 1;
            updateProgress();
          }
        },
        () => cancelled,
      );

      if (cancelled || controller.signal.aborted) {
        cancelCopyDetails(operationId);
        completeOperation(operationId, "cancelled");
        onStatus(
          `${isMove ? "Move" : "Copy"} cancelled after ${succeeded} of ${total} item(s).`,
        );
        await onRefreshNow(destinationPrefix);
        return;
      }

      const completionError =
        failures > 0 ? "Some items failed to copy or move." : undefined;
      completeOperation(
        operationId,
        failures > 0 ? "failed" : "done",
        completionError,
      );
      onStatus(
        `${isMove ? "Moved" : "Copied"} ${total - failures} of ${total} item(s).`,
      );
      await onRefreshNow(destinationPrefix);
      if (isMove && failures === 0) setClipboard(null);
    } catch (caughtError) {
      if (isAbortError(caughtError) || controller.signal.aborted) {
        cancelCopyDetails(operationId);
        completeOperation(operationId, "cancelled");
        onStatus(
          `${isMove ? "Move" : "Copy"} cancelled after ${succeeded} of ${total} item(s).`,
        );
        await onRefreshNow(destinationPrefix);
        return;
      }
      const completionError = formatBrowserOperationError(
        caughtError,
        "Unable to paste items.",
        "Unable to paste items.",
      );
      completeOperation(operationId, "failed", completionError);
      onStatus(completionError);
    } finally {
      clearOperationController(operationId);
    }
  }, [
    accountId,
    bucketName,
    cancelCopyDetails,
    clearOperationController,
    clipboard,
    clipboardMatchesContext,
    completeOperation,
    createOperationController,
    deleteObject,
    downloadBlob,
    downloadStream,
    enabled,
    functionalProfile,
    getSseCustomerKeyForScope,
    listAllObjectsForPrefix,
    normalizedPrefix,
    onRefreshNow,
    onStatus,
    onWarning,
    parallelism,
    requestOptions,
    resolveTransferMode,
    setCopyDetails,
    showOperations,
    startOperation,
    updateCopyDetailStatus,
    updateOperation,
    uploadBlob,
    uploadMultipartStream,
  ]);

  return useMemo(
    () => ({
      canPaste: canPasteInFunctionalProfile,
      clipboard,
      copy,
      cut,
      paste,
    }),
    [canPasteInFunctionalProfile, clipboard, copy, cut, paste],
  );
}

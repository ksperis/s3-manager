/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  updateObjectAcl,
  updateObjectLegalHold,
  updateObjectMetadata,
  updateObjectRetention,
  updateObjectTags,
} from "../../api/browser";
import { runWithConcurrency } from "../../utils/concurrency";
import type { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";
import type { BrowserItem, BulkMetadataDraft } from "./browserTypes";
import {
  normalizePrefix,
  pairsToRecord,
  parseKeyValueLines,
  toIsoString,
} from "./browserUtils";

type OperationRegistry = ReturnType<typeof useBrowserOperationRegistry>;

export type BrowserBulkAttributesDraft = {
  applyAcl: boolean;
  applyLegalHold: boolean;
  applyMetadata: boolean;
  applyRetention: boolean;
  applyStorageClass: boolean;
  applyTags: boolean;
  aclValue: string;
  legalHoldStatus: "ON" | "OFF";
  metadata: BulkMetadataDraft;
  metadataEntries: string;
  retentionBypass: boolean;
  retentionDate: string;
  retentionMode: "" | "GOVERNANCE" | "COMPLIANCE";
  storageClass: string;
  tags: string;
};

type UseBrowserBulkAttributesOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  clearOperationController: OperationRegistry["clearOperationController"];
  completeOperation: OperationRegistry["completeOperation"];
  createOperationController: OperationRegistry["createOperationController"];
  currentPath: string;
  enabled: boolean;
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  onRefresh: (prefix: string) => void;
  onRefreshNow: (prefix: string) => Promise<void>;
  onStatus: (message: string) => void;
  onWarning: (message: string | null) => void;
  parallelism: number;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
  showOperations: () => void;
  startOperation: OperationRegistry["startOperation"];
  updateOperation: OperationRegistry["updateOperation"];
};

function createEmptyMetadataDraft(): BulkMetadataDraft {
  return {
    contentType: "",
    cacheControl: "",
    contentDisposition: "",
    contentEncoding: "",
    contentLanguage: "",
    expires: "",
  };
}

export function createBrowserBulkAttributesDraft(): BrowserBulkAttributesDraft {
  return {
    applyAcl: false,
    applyLegalHold: false,
    applyMetadata: false,
    applyRetention: false,
    applyStorageClass: false,
    applyTags: false,
    aclValue: "private",
    legalHoldStatus: "OFF",
    metadata: createEmptyMetadataDraft(),
    metadataEntries: "",
    retentionBypass: false,
    retentionDate: "",
    retentionMode: "",
    storageClass: "",
    tags: "",
  };
}

export function useBrowserBulkAttributes({
  accountId,
  bucketName,
  clearOperationController,
  completeOperation,
  createOperationController,
  currentPath,
  enabled,
  listAllObjectsForPrefix,
  onRefresh,
  onRefreshNow,
  onStatus,
  onWarning,
  parallelism,
  prefix,
  requestOptions,
  showOperations,
  startOperation,
  updateOperation,
}: UseBrowserBulkAttributesOptions) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<BrowserItem[]>([]);
  const [draft, setDraft] = useState(createBrowserBulkAttributesDraft);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const fileCount = useMemo(
    () => targets.filter((item) => item.type === "file").length,
    [targets],
  );
  const folderCount = useMemo(
    () => targets.filter((item) => item.type === "folder").length,
    [targets],
  );

  const reset = useCallback(() => {
    setDraft(createBrowserBulkAttributesDraft());
    setError(null);
    setSummary(null);
  }, []);

  const show = useCallback(
    (items: BrowserItem[]) => {
      const eligibleItems = items.filter((item) => !item.isDeleted);
      if (eligibleItems.length === 0) {
        onStatus("Deleted objects cannot receive bulk attributes.");
        return;
      }
      onWarning(
        eligibleItems.length !== items.length
          ? "Deleted objects were skipped for bulk attributes."
          : null,
      );
      setTargets(eligibleItems);
      reset();
      setOpen(true);
    },
    [onStatus, onWarning, reset],
  );

  const close = useCallback(() => setOpen(false), []);

  const resolveTargetKeys = useCallback(async () => {
    const keys = new Set<string>();
    targets
      .filter((item) => item.type === "file")
      .forEach((item) => keys.add(item.key));
    for (const folder of targets.filter((item) => item.type === "folder")) {
      const objects = await listAllObjectsForPrefix(normalizePrefix(folder.key));
      objects.forEach((object) => keys.add(object.key));
    }
    return Array.from(keys);
  }, [listAllObjectsForPrefix, targets]);

  const apply = useCallback(async () => {
    if (!bucketName || !enabled) return;
    if (
      !draft.applyMetadata &&
      !draft.applyTags &&
      !draft.applyStorageClass &&
      !draft.applyAcl &&
      !draft.applyLegalHold &&
      !draft.applyRetention
    ) {
      setError("Select at least one attribute to update.");
      return;
    }

    const metadataPairs = parseKeyValueLines(draft.metadataEntries);
    const tagsPairs = parseKeyValueLines(draft.tags);
    const expiresIso = draft.metadata.expires.trim()
      ? toIsoString(draft.metadata.expires)
      : "";
    const metadataHasValues =
      Boolean(draft.metadata.contentType.trim()) ||
      Boolean(draft.metadata.cacheControl.trim()) ||
      Boolean(draft.metadata.contentDisposition.trim()) ||
      Boolean(draft.metadata.contentEncoding.trim()) ||
      Boolean(draft.metadata.contentLanguage.trim()) ||
      Boolean(expiresIso) ||
      metadataPairs.length > 0;

    if (draft.applyMetadata && !metadataHasValues) {
      setError("Provide at least one metadata field.");
      return;
    }
    if (draft.applyStorageClass && !draft.storageClass) {
      setError("Select a storage class.");
      return;
    }
    if (
      draft.applyMetadata &&
      draft.metadata.expires.trim() &&
      !expiresIso
    ) {
      setError("Provide a valid expires date.");
      return;
    }
    if (draft.applyTags && tagsPairs.length === 0) {
      setError("Provide at least one tag.");
      return;
    }
    const retentionIso = draft.retentionDate
      ? toIsoString(draft.retentionDate)
      : "";
    if (
      draft.applyRetention &&
      (!draft.retentionMode || !draft.retentionDate || !retentionIso)
    ) {
      setError("Provide retention mode and date.");
      return;
    }

    setLoading(true);
    setError(null);
    setSummary(null);
    let operationId: string | null = null;
    let controller: AbortController | null = null;
    try {
      const keys = await resolveTargetKeys();
      if (keys.length === 0) {
        setError("No objects to update.");
        return;
      }
      if (keys.length > 1) {
        showOperations();
      }
      operationId = startOperation(
        "copying",
        "Updating attributes",
        currentPath || bucketName,
        { kind: "other", cancelable: true },
        0,
      );
      controller = createOperationController(operationId);
      const total = keys.length;
      let completed = 0;
      let succeeded = 0;
      let failures = 0;
      let cancelled = false;
      const metadataRecord =
        metadataPairs.length > 0 ? pairsToRecord(metadataPairs) : undefined;

      const applyForKey = async (key: string) => {
        if (draft.applyMetadata || draft.applyStorageClass) {
          await updateObjectMetadata(
            accountId,
            bucketName,
            {
              key,
              content_type:
                draft.applyMetadata && draft.metadata.contentType.trim()
                  ? draft.metadata.contentType.trim()
                  : undefined,
              cache_control:
                draft.applyMetadata && draft.metadata.cacheControl.trim()
                  ? draft.metadata.cacheControl.trim()
                  : undefined,
              content_disposition:
                draft.applyMetadata &&
                draft.metadata.contentDisposition.trim()
                  ? draft.metadata.contentDisposition.trim()
                  : undefined,
              content_encoding:
                draft.applyMetadata && draft.metadata.contentEncoding.trim()
                  ? draft.metadata.contentEncoding.trim()
                  : undefined,
              content_language:
                draft.applyMetadata && draft.metadata.contentLanguage.trim()
                  ? draft.metadata.contentLanguage.trim()
                  : undefined,
              expires:
                draft.applyMetadata && expiresIso ? expiresIso : undefined,
              metadata:
                draft.applyMetadata && metadataRecord
                  ? metadataRecord
                  : undefined,
              storage_class: draft.applyStorageClass
                ? draft.storageClass
                : undefined,
            },
            controller?.signal,
            requestOptions,
          );
        }
        if (draft.applyTags) {
          await updateObjectTags(
            accountId,
            bucketName,
            { key, tags: tagsPairs },
            controller?.signal,
            requestOptions,
          );
        }
        if (draft.applyAcl) {
          await updateObjectAcl(
            accountId,
            bucketName,
            { key, acl: draft.aclValue },
            controller?.signal,
            requestOptions,
          );
        }
        if (draft.applyLegalHold) {
          await updateObjectLegalHold(
            accountId,
            bucketName,
            { key, status: draft.legalHoldStatus },
            controller?.signal,
            requestOptions,
          );
        }
        if (draft.applyRetention) {
          await updateObjectRetention(
            accountId,
            bucketName,
            {
              key,
              mode: draft.retentionMode || null,
              retain_until: retentionIso,
              bypass_governance: draft.retentionBypass,
            },
            controller?.signal,
            requestOptions,
          );
        }
      };

      await runWithConcurrency(
        keys,
        parallelism,
        async (key) => {
          if (controller?.signal.aborted) {
            cancelled = true;
            return;
          }
          try {
            await applyForKey(key);
            succeeded += 1;
          } catch {
            if (controller?.signal.aborted) {
              cancelled = true;
              return;
            }
            failures += 1;
          } finally {
            completed += 1;
            const progress =
              total > 0 ? Math.round((completed / total) * 100) : 100;
            updateOperation(operationId, { progress });
          }
        },
        () => cancelled,
      );
      if (cancelled || controller.signal.aborted) {
        const nextSummary = `Update cancelled after ${succeeded} of ${total} item(s).`;
        completeOperation(operationId, "cancelled");
        setSummary(nextSummary);
        onStatus(nextSummary);
        await onRefreshNow(prefix);
        return;
      }
      completeOperation(
        operationId,
        failures > 0 ? "failed" : "done",
        failures > 0
          ? "Some objects failed to update attributes."
          : undefined,
      );
      const nextSummary = `Updated ${Math.max(0, total - failures)} of ${total} object(s).`;
      setSummary(nextSummary);
      onStatus(nextSummary);
      onRefresh(prefix);
    } catch {
      setError("Unable to update attributes.");
    } finally {
      if (operationId) {
        clearOperationController(operationId);
      }
      setLoading(false);
    }
  }, [
    accountId,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    draft,
    enabled,
    onRefresh,
    onRefreshNow,
    onStatus,
    parallelism,
    prefix,
    requestOptions,
    resolveTargetKeys,
    showOperations,
    startOperation,
    updateOperation,
  ]);

  return {
    apply,
    close,
    draft,
    error,
    fileCount,
    folderCount,
    loading,
    open,
    setDraft,
    show,
    summary,
  };
}

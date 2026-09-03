/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useRef, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchObjectMetadata,
  getObjectTags,
  updateObjectMetadata,
  updateObjectTags,
} from "../../api/browserObjects";
import type {
  ObjectMetadata,
  ObjectMetadataUpdate,
  ObjectTag,
  ObjectTags,
} from "../../api/browserContracts";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime, toIsoString } from "./browserUtils";
import { normalizeObjectDetailPairs } from "./browserObjectDetailsModel";
import { runBrowserScopedSave } from "./browserScopedSave";
import type { BrowserItem } from "./browserTypes";

export type BrowserObjectMetadataDraft = {
  contentType: string;
  cacheControl: string;
  contentDisposition: string;
  contentEncoding: string;
  contentLanguage: string;
  expires: string;
};

export type BrowserObjectPropertyEntry = ObjectTag & { id: string };
export type BrowserObjectPropertyEntryField = "key" | "value";

type UseBrowserObjectPropertiesOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  isDeleted: boolean;
  item: BrowserItem;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64?: string | null;
};

const emptyMetadataDraft = (): BrowserObjectMetadataDraft => ({
  contentType: "",
  cacheControl: "",
  contentDisposition: "",
  contentEncoding: "",
  contentLanguage: "",
  expires: "",
});

export function useBrowserObjectProperties({
  accountId,
  bucketName,
  isDeleted,
  item,
  requestOptions,
  sseCustomerKeyBase64,
}: UseBrowserObjectPropertiesOptions) {
  const scope = JSON.stringify([
    accountId,
    bucketName,
    isDeleted,
    item.key,
    item.type,
    requestOptions?.workspaceSurface ?? null,
    sseCustomerKeyBase64 ?? null,
  ]);
  const [metadata, setMetadata] = useState<ObjectMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagsVersionId, setTagsVersionId] = useState<string | null>(null);
  const [metadataDraft, setMetadataDraft] = useState(emptyMetadataDraft);
  const [metadataItems, setMetadataItems] = useState<
    BrowserObjectPropertyEntry[]
  >([]);
  const [tagsDraft, setTagsDraft] = useState<BrowserObjectPropertyEntry[]>([]);
  const [storageClass, setStorageClass] = useState("");
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const [savingStorageClass, setSavingStorageClass] = useState(false);
  const tagIdRef = useRef(0);
  const metadataIdRef = useRef(0);
  const loadingRef = useRef(false);
  const loadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const nextTagId = useCallback(() => {
    tagIdRef.current += 1;
    return `tag-${tagIdRef.current}`;
  }, []);

  const nextMetadataId = useCallback(() => {
    metadataIdRef.current += 1;
    return `meta-${metadataIdRef.current}`;
  }, []);

  const updateMetadataDraft = useCallback(
    (field: keyof BrowserObjectMetadataDraft, value: string) => {
      setMetadataDraft((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const addMetadataItem = useCallback(() => {
    setMetadataItems((current) => [
      ...current,
      { id: nextMetadataId(), key: "", value: "" },
    ]);
  }, [nextMetadataId]);

  const updateMetadataItem = useCallback(
    (
      id: string,
      field: BrowserObjectPropertyEntryField,
      value: string,
    ) => {
      setMetadataItems((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, [field]: value } : entry,
        ),
      );
    },
    [],
  );

  const removeMetadataItem = useCallback((id: string) => {
    setMetadataItems((current) =>
      current.filter((entry) => entry.id !== id),
    );
  }, []);

  const addTag = useCallback(() => {
    setTagsDraft((current) => [
      ...current,
      { id: nextTagId(), key: "", value: "" },
    ]);
  }, [nextTagId]);

  const updateTag = useCallback(
    (
      id: string,
      field: BrowserObjectPropertyEntryField,
      value: string,
    ) => {
      setTagsDraft((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, [field]: value } : entry,
        ),
      );
    },
    [],
  );

  const removeTag = useCallback((id: string) => {
    setTagsDraft((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const resetPropertiesDrafts = useCallback(
    (nextMetadata: ObjectMetadata | null, baseItem: BrowserItem) => {
      if (!nextMetadata) {
        setMetadataDraft(emptyMetadataDraft());
        setMetadataItems([]);
        setStorageClass(baseItem.storageClass ?? "");
        return;
      }
      setMetadataDraft({
        contentType: nextMetadata.content_type ?? "",
        cacheControl: nextMetadata.cache_control ?? "",
        contentDisposition: nextMetadata.content_disposition ?? "",
        contentEncoding: nextMetadata.content_encoding ?? "",
        contentLanguage: nextMetadata.content_language ?? "",
        expires: formatLocalDateTime(nextMetadata.expires),
      });
      setMetadataItems(
        Object.entries(nextMetadata.metadata || {}).map(([key, value]) => ({
          id: nextMetadataId(),
          key,
          value,
        })),
      );
      setStorageClass(nextMetadata.storage_class ?? baseItem.storageClass ?? "");
    },
    [nextMetadataId],
  );

  const resetTagsDraft = useCallback(
    (nextTags: ObjectTag[]) => {
      setTagsDraft(
        nextTags.map((tag) => ({
          id: nextTagId(),
          key: tag.key,
          value: tag.value,
        })),
      );
    },
    [nextTagId],
  );

  const reset = useCallback(
    (baseItem: BrowserItem) => {
      requestIdRef.current += 1;
      loadingRef.current = false;
      loadedRef.current = false;
      setMetadata(null);
      setLoading(false);
      setLoaded(false);
      setError(null);
      setTagsVersionId(null);
      setSavingMetadata(false);
      setSavingTags(false);
      setSavingStorageClass(false);
      resetPropertiesDrafts(null, baseItem);
      resetTagsDraft([]);
    },
    [resetPropertiesDrafts, resetTagsDraft],
  );

  const isCurrentScope = useCallback(
    () => scope === scopeRef.current,
    [scope],
  );

  const load = useCallback(
    async (force = false) => {
      if (scope !== scopeRef.current) return;
      if (!accountId || !bucketName || item.type !== "file" || isDeleted) {
        return;
      }
      if (!force && (loadingRef.current || loadedRef.current)) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const [nextMetadata, nextTags] = await Promise.all([
          fetchObjectMetadata(
            accountId,
            bucketName,
            item.key,
            null,
            sseCustomerKeyBase64,
            undefined,
            requestOptions,
          ),
          getObjectTags(
            accountId,
            bucketName,
            item.key,
            null,
            requestOptions,
          ),
        ]);
        if (requestId !== requestIdRef.current) return;
        setMetadata(nextMetadata);
        setTagsVersionId(nextTags.version_id ?? null);
        resetPropertiesDrafts(nextMetadata, item);
        resetTagsDraft(nextTags.tags ?? []);
        loadedRef.current = true;
        setLoaded(true);
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return;
        setError(
          extractApiError(loadError, "Unable to load object details."),
        );
        if (force) {
          setMetadata(null);
          setTagsVersionId(null);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [
      accountId,
      bucketName,
      isDeleted,
      item,
      requestOptions,
      resetPropertiesDrafts,
      resetTagsDraft,
      scope,
      sseCustomerKeyBase64,
    ],
  );

  const saveMetadata = useCallback(async () => {
    if (!isCurrentScope() || !accountId || !bucketName || !item.key) {
      return false;
    }
    return (
      (await runBrowserScopedSave(isCurrentScope, setSavingMetadata, async () => {
        const payload: ObjectMetadataUpdate = {
          key: item.key,
          version_id: metadata?.version_id ?? tagsVersionId ?? null,
          content_type: metadataDraft.contentType,
          cache_control: metadataDraft.cacheControl,
          content_disposition: metadataDraft.contentDisposition,
          content_encoding: metadataDraft.contentEncoding,
          content_language: metadataDraft.contentLanguage,
          expires: toIsoString(metadataDraft.expires),
          metadata: normalizeObjectDetailPairs(metadataItems),
        };
        await updateObjectMetadata(
          accountId,
          bucketName,
          payload,
          undefined,
          requestOptions,
        );
        await load(true);
        return true;
      })) ?? false
    );
  }, [
    accountId,
    bucketName,
    isCurrentScope,
    item.key,
    load,
    metadata?.version_id,
    metadataDraft,
    metadataItems,
    requestOptions,
    tagsVersionId,
  ]);

  const saveTags = useCallback(async () => {
    if (!isCurrentScope() || !accountId || !bucketName || !item.key) {
      return false;
    }
    return (
      (await runBrowserScopedSave(isCurrentScope, setSavingTags, async () => {
        await updateObjectTags(
          accountId,
          bucketName,
          {
            key: item.key,
            version_id: metadata?.version_id ?? tagsVersionId ?? null,
            tags: tagsDraft
              .filter((tag) => tag.key.trim().length > 0)
              .map((tag) => ({ key: tag.key, value: tag.value })),
          } satisfies ObjectTags,
          undefined,
          requestOptions,
        );
        await load(true);
        return true;
      })) ?? false
    );
  }, [
    accountId,
    bucketName,
    isCurrentScope,
    item.key,
    load,
    metadata?.version_id,
    requestOptions,
    tagsDraft,
    tagsVersionId,
  ]);

  const saveStorageClass = useCallback(async () => {
    if (
      !isCurrentScope() ||
      !accountId ||
      !bucketName ||
      !item.key ||
      !storageClass
    ) {
      return null;
    }
    return runBrowserScopedSave(isCurrentScope, setSavingStorageClass, async () => {
      await updateObjectMetadata(
        accountId,
        bucketName,
        {
          key: item.key,
          version_id: metadata?.version_id ?? tagsVersionId ?? null,
          storage_class: storageClass,
        },
        undefined,
        requestOptions,
      );
      await load(true);
      return storageClass;
    });
  }, [
    accountId,
    bucketName,
    isCurrentScope,
    item.key,
    load,
    metadata?.version_id,
    requestOptions,
    storageClass,
    tagsVersionId,
  ]);

  return {
    metadata,
    loading,
    loaded,
    error,
    versionId: metadata?.version_id ?? tagsVersionId ?? undefined,
    metadataDraft,
    updateMetadataDraft,
    metadataItems,
    addMetadataItem,
    updateMetadataItem,
    removeMetadataItem,
    tagsDraft,
    addTag,
    updateTag,
    removeTag,
    storageClass,
    setStorageClass,
    savingMetadata,
    savingTags,
    savingStorageClass,
    load,
    reset,
    isCurrentScope,
    saveMetadata,
    saveTags,
    saveStorageClass,
  };
}

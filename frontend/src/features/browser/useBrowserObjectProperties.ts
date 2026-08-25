/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchObjectMetadata,
  getObjectTags,
  updateObjectMetadata,
  updateObjectTags,
  type BrowserRequestOptions,
  type ObjectMetadata,
  type ObjectMetadataUpdate,
  type ObjectTag,
  type ObjectTags,
} from "../../api/browser";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime, toIsoString } from "./browserUtils";
import { normalizeObjectDetailPairs } from "./browserObjectDetailsModel";
import type { BrowserItem } from "./browserTypes";

type MetadataDraft = {
  contentType: string;
  cacheControl: string;
  contentDisposition: string;
  contentEncoding: string;
  contentLanguage: string;
  expires: string;
};

type MetadataDraftItem = ObjectTag & { id: string };
type TagDraft = ObjectTag & { id: string };

type UseBrowserObjectPropertiesOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  isDeleted: boolean;
  item: BrowserItem;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64?: string | null;
};

const emptyMetadataDraft = (): MetadataDraft => ({
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
  const [metadataItems, setMetadataItems] = useState<MetadataDraftItem[]>([]);
  const [tagsDraft, setTagsDraft] = useState<TagDraft[]>([]);
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

  const runSave = useCallback(
    async <T>(
      setSaving: (value: boolean) => void,
      operation: () => Promise<T>,
    ): Promise<T | null> => {
      if (!isCurrentScope()) return null;
      setSaving(true);
      try {
        const result = await operation();
        return isCurrentScope() ? result : null;
      } catch (saveError) {
        if (!isCurrentScope()) return null;
        throw saveError;
      } finally {
        if (isCurrentScope()) setSaving(false);
      }
    },
    [isCurrentScope],
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
      (await runSave(setSavingMetadata, async () => {
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
    runSave,
    tagsVersionId,
  ]);

  const saveTags = useCallback(async () => {
    if (!isCurrentScope() || !accountId || !bucketName || !item.key) {
      return false;
    }
    return (
      (await runSave(setSavingTags, async () => {
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
    runSave,
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
    return runSave(setSavingStorageClass, async () => {
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
    runSave,
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
    setMetadataDraft,
    metadataItems,
    setMetadataItems,
    tagsDraft,
    setTagsDraft,
    storageClass,
    setStorageClass,
    savingMetadata,
    savingTags,
    savingStorageClass,
    nextTagId,
    nextMetadataId,
    load,
    reset,
    isCurrentScope,
    saveMetadata,
    saveTags,
    saveStorageClass,
  };
}

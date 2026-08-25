/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchObjectMetadata,
  getObjectTags,
  type BrowserRequestOptions,
  type ObjectMetadata,
  type ObjectTag,
} from "../../api/browser";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime } from "./browserUtils";
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
      resetPropertiesDrafts(null, baseItem);
      resetTagsDraft([]);
    },
    [resetPropertiesDrafts, resetTagsDraft],
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
    nextTagId,
    nextMetadataId,
    load,
    reset,
  };
}

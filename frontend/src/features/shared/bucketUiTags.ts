/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchCephAdminBucketUiTags,
  fetchStorageOpsBucketUiTags,
  patchCephAdminBucketUiTags,
  patchCephAdminBucketUiTagDefinition,
  patchStorageOpsBucketUiTags,
  patchStorageOpsBucketUiTagDefinition,
  type BucketUiTagCatalog,
  type BucketUiTagCreate,
  type BucketUiTagDefinition,
  type BucketUiTagDefinitionPatch,
  type BucketUiTagVisibility,
} from "../../api/bucketUiTags";
import type { BucketOpsMode } from "./bucketOpsSurface";

const STATE_KEY_SEPARATOR = "\u001e";
const MUTATION_BATCH_SIZE = 200;
const EMPTY_BUCKET_UI_TAG_CATALOG: BucketUiTagCatalog = { definitions: [] };

export type BucketUiTagTarget = {
  key: string;
  endpointId: number;
  identity: string;
  name: string;
  tenant: string | null;
  contextId: string | null;
};

type BucketUiTagMutationItem =
  | BucketUiTagDefinition
  | {
      label: string;
      color_key?: string;
      visibility?: BucketUiTagVisibility;
    };

const buildBucketUiTagStateKey = (mode: BucketOpsMode, endpointId: number, identity: string) =>
  `${mode}${STATE_KEY_SEPARATOR}${endpointId}${STATE_KEY_SEPARATOR}${identity}`;

export const buildPhysicalBucketUiTagIdentity = (endpointId: number, tenant: string | null, name: string) =>
  JSON.stringify([endpointId, String(tenant ?? "").trim(), name]);

export const createBucketUiTagTarget = (
  mode: BucketOpsMode,
  endpointId: number | null | undefined,
  identity: string | null | undefined,
  name: string,
  tenant?: string | null,
  contextId?: string | null
): BucketUiTagTarget | null => {
  const normalizedIdentity = String(identity ?? "").trim();
  const normalizedName = String(name ?? "").trim();
  if (!endpointId || !normalizedIdentity || !normalizedName) return null;
  return {
    key: buildBucketUiTagStateKey(mode, endpointId, normalizedIdentity),
    endpointId,
    identity: normalizedIdentity,
    name: normalizedName,
    tenant: String(tenant ?? "").trim() || null,
    contextId: String(contextId ?? "").trim() || null,
  };
};

const chunks = <T,>(values: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) result.push(values.slice(start, start + size));
  return result;
};

const isPersistedDefinition = (item: BucketUiTagMutationItem): item is BucketUiTagDefinition =>
  "id" in item && Number.isInteger(item.id) && item.id > 0;

const toStorageOpsMutationTarget = (target: BucketUiTagTarget) => {
  if (!target.contextId) {
    throw new Error("Storage Ops UI tag targets require an execution context.");
  }
  return { context_id: target.contextId, name: target.name };
};

export function useBucketUiTags(
  mode: BucketOpsMode,
  selectedEndpointId?: number | null,
  onMutated?: () => void
) {
  const catalogScopeKey = `${mode}:${selectedEndpointId ?? ""}`;
  const [catalog, setCatalog] = useState<BucketUiTagCatalog>(EMPTY_BUCKET_UI_TAG_CATALOG);
  const [loading, setLoading] = useState(true);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [updatingDefinitionIds, setUpdatingDefinitionIds] = useState<Set<number>>(
    () => new Set()
  );
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    if (mode === "ceph-admin" && !selectedEndpointId) {
      setCatalog(EMPTY_BUCKET_UI_TAG_CATALOG);
      setError(null);
      setLoadedScopeKey(catalogScopeKey);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMutating(false);
    setError(null);
    const catalogRequest = mode === "ceph-admin"
      ? fetchCephAdminBucketUiTags(Number(selectedEndpointId))
      : fetchStorageOpsBucketUiTags();
    try {
      const nextCatalog = await catalogRequest;
      if (requestId === requestSequenceRef.current) {
        setCatalog(nextCatalog);
        setLoadedScopeKey(catalogScopeKey);
      }
    } catch (catalogError) {
      if (requestId === requestSequenceRef.current) {
        setCatalog(EMPTY_BUCKET_UI_TAG_CATALOG);
        setError(
          catalogError instanceof Error
            ? catalogError.message
            : "Unable to load bucket UI tags."
        );
      }
    } finally {
      if (requestId === requestSequenceRef.current) setLoading(false);
    }
  }, [catalogScopeKey, mode, selectedEndpointId]);

  useEffect(() => {
    void reload();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [reload]);

  // Do not expose the previous endpoint's definitions while a new Ceph Admin
  // scope is loading or has failed to load.
  const visibleCatalog = loadedScopeKey === catalogScopeKey ? catalog : EMPTY_BUCKET_UI_TAG_CATALOG;
  const definitions = useMemo(
    () => [...visibleCatalog.definitions].sort((a, b) => a.label.localeCompare(b.label) || a.id - b.id),
    [visibleCatalog.definitions]
  );
  const applyTags = useCallback(
    async (
      targets: BucketUiTagTarget[],
      add: BucketUiTagMutationItem[],
      remove: BucketUiTagDefinition[],
      options?: {
        removeAll?: boolean;
        onProgress?: (progress: { completed: number; total: number }) => void;
      }
    ) => {
      if (targets.length === 0) return;
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      setLoading(false);
      setMutating(true);
      setError(null);
      const addTagIds = add.filter(isPersistedDefinition).map((tag) => tag.id);
      const createTags: BucketUiTagCreate[] = add
        .filter((item) => !isPersistedDefinition(item))
        .map((item) => ({
          label: item.label.trim(),
          color_key: item.color_key ?? "neutral",
          ...(mode === "ceph-admin" ? { visibility: item.visibility ?? "private" } : {}),
        }))
        .filter((item) => item.label.length > 0);
      let nextCatalog = catalog;
      let completed = 0;
      try {
        for (const batch of chunks(targets, MUTATION_BATCH_SIZE)) {
          nextCatalog =
            mode === "ceph-admin"
              ? await patchCephAdminBucketUiTags(Number(selectedEndpointId), {
                  targets: batch.map((target) => ({ name: target.name, tenant: target.tenant ?? "" })),
                  add_tag_ids: addTagIds,
                  create_tags: createTags,
                  remove_tag_ids: remove.map((tag) => tag.id),
                  remove_all: options?.removeAll,
                })
              : await patchStorageOpsBucketUiTags({
                  targets: batch.map(toStorageOpsMutationTarget),
                  add_tag_ids: addTagIds,
                  create_tags: createTags.map(({ visibility: _visibility, ...tag }) => tag),
                  remove_tag_ids: remove.map((tag) => tag.id),
                  remove_all: options?.removeAll,
                });
          completed += batch.length;
          options?.onProgress?.({ completed, total: targets.length });
        }
        if (requestId === requestSequenceRef.current) {
          setCatalog(nextCatalog);
          setLoadedScopeKey(catalogScopeKey);
          onMutated?.();
        }
      } catch (err) {
        if (completed > 0 && requestId === requestSequenceRef.current) {
          // Earlier batches are already committed by the backend. Keep the
          // local catalog aligned with that partial success before surfacing
          // the failing batch.
          setCatalog(nextCatalog);
          setLoadedScopeKey(catalogScopeKey);
          onMutated?.();
        }
        if (requestId === requestSequenceRef.current) {
          setError(err instanceof Error ? err.message : "Unable to update bucket UI tags.");
        }
        throw err;
      } finally {
        if (requestId === requestSequenceRef.current) setMutating(false);
      }
    },
    [catalog, catalogScopeKey, mode, onMutated, selectedEndpointId]
  );

  const updateDefinition = useCallback(
    async (tagId: number, changes: BucketUiTagDefinitionPatch) => {
      setUpdatingDefinitionIds((current) => new Set(current).add(tagId));
      setError(null);
      try {
        const updated =
          mode === "ceph-admin"
            ? await patchCephAdminBucketUiTagDefinition(
                Number(selectedEndpointId),
                tagId,
                changes
              )
            : await patchStorageOpsBucketUiTagDefinition(tagId, {
                color_key: changes.color_key,
              });
        setCatalog((current) => ({
          definitions: current.definitions.map((definition) =>
            definition.id === updated.id ? updated : definition
          ),
        }));
        onMutated?.();
        return updated;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to update bucket UI tag settings."
        );
        throw err;
      } finally {
        setUpdatingDefinitionIds((current) => {
          const next = new Set(current);
          next.delete(tagId);
          return next;
        });
      }
    },
    [mode, onMutated, selectedEndpointId]
  );

  const ready = loadedScopeKey === catalogScopeKey && !loading && error === null;
  return {
    definitions,
    loading,
    ready,
    mutating,
    updatingDefinitionIds,
    error,
    reload,
    applyTags,
    updateDefinition,
  };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchCephAdminBucketUiTags,
  fetchStorageOpsBucketUiTags,
  patchCephAdminBucketUiTags,
  patchStorageOpsBucketUiTags,
  type BucketUiTagCatalog,
  type BucketUiTagCreate,
  type BucketUiTagDefinition,
  type BucketUiTagVisibility,
} from "../../api/bucketUiTags";
import type { BucketOpsMode } from "./bucketOpsSurface";

// Kept only so old v2 browser data remains untouched. It is never read.
const UI_TAGS_V2_PREFIX = "bucket-workbench.ui_tags.v2";
const STATE_KEY_SEPARATOR = "\u001e";
const MUTATION_BATCH_SIZE = 200;
const EMPTY_BUCKET_UI_TAG_CATALOG: BucketUiTagCatalog = { definitions: [], assignments: [] };

export type BucketUiTagTarget = {
  key: string;
  endpointId: number;
  identity: string;
  name: string;
  tenant: string | null;
  contextId: string | null;
};

type BucketUiTagEntry = {
  target: BucketUiTagTarget;
  tags: BucketUiTagDefinition[];
};

type BucketUiTagMutationItem =
  | BucketUiTagDefinition
  | {
      label: string;
      color_key?: string;
      visibility?: BucketUiTagVisibility;
    };

export const buildBucketUiTagsStorageKey = (mode: BucketOpsMode, endpointId: number) =>
  `${UI_TAGS_V2_PREFIX}.${mode}.${endpointId}`;

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

const catalogEntries = (mode: BucketOpsMode, catalog: BucketUiTagCatalog): Record<string, BucketUiTagEntry> => {
  const definitions = new Map(catalog.definitions.map((definition) => [definition.id, definition]));
  const entries: Record<string, BucketUiTagEntry> = {};
  catalog.assignments.forEach((assignment) => {
    const { endpoint_id: endpointId, tenant, name } = assignment.target;
    const identity =
      mode === "storage-ops"
        ? buildPhysicalBucketUiTagIdentity(endpointId, tenant, name)
        : `${tenant ? `${tenant}/` : ""}${name}`;
    const target = createBucketUiTagTarget(mode, endpointId, identity, name, tenant);
    if (!target) return;
    const tags = assignment.tag_ids
      .map((id) => definitions.get(id))
      .filter((definition): definition is BucketUiTagDefinition => Boolean(definition));
    if (tags.length > 0) entries[target.key] = { target, tags };
  });
  return entries;
};

const chunks = <T,>(values: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) result.push(values.slice(start, start + size));
  return result;
};

const isPersistedDefinition = (item: BucketUiTagMutationItem): item is BucketUiTagDefinition =>
  "id" in item && Number.isInteger(item.id) && item.id > 0;

export function useBucketUiTags(
  mode: BucketOpsMode,
  selectedEndpointId?: number | null,
  onMutated?: () => void
) {
  const catalogScopeKey = `${mode}:${selectedEndpointId ?? ""}`;
  const [catalog, setCatalog] = useState<BucketUiTagCatalog>({ definitions: [], assignments: [] });
  const [loading, setLoading] = useState(true);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    if (mode === "ceph-admin" && !selectedEndpointId) {
      setCatalog({ definitions: [], assignments: [] });
      setError(null);
      setLoadedScopeKey(catalogScopeKey);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextCatalog =
        mode === "ceph-admin"
          ? await fetchCephAdminBucketUiTags(Number(selectedEndpointId))
          : await fetchStorageOpsBucketUiTags();
      if (requestId === requestSequenceRef.current) {
        setCatalog(nextCatalog);
        setLoadedScopeKey(catalogScopeKey);
      }
    } catch (err) {
      if (requestId === requestSequenceRef.current) {
        setError(err instanceof Error ? err.message : "Unable to load bucket UI tags.");
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

  // Do not expose the previous endpoint's catalogue while a new Ceph Admin
  // scope is loading or has failed to load. Definitions are shared by domain,
  // but assignments are endpoint-specific and must never bleed between views.
  const visibleCatalog = loadedScopeKey === catalogScopeKey ? catalog : EMPTY_BUCKET_UI_TAG_CATALOG;
  const entries = useMemo(() => catalogEntries(mode, visibleCatalog), [mode, visibleCatalog]);
  const definitions = useMemo(
    () => [...visibleCatalog.definitions].sort((a, b) => a.label.localeCompare(b.label) || a.id - b.id),
    [visibleCatalog.definitions]
  );
  const tags = useMemo(
    () => Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry.tags])) as Record<
      string,
      BucketUiTagDefinition[]
    >,
    [entries]
  );

  const applyTags = useCallback(
    async (
      targets: BucketUiTagTarget[],
      add: BucketUiTagMutationItem[],
      remove: BucketUiTagDefinition[],
      options?: {
        removeAll?: boolean;
        requireAbsent?: boolean;
        onProgress?: (progress: { completed: number; total: number }) => void;
      }
    ) => {
      if (targets.length === 0) return;
      requestSequenceRef.current += 1;
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
                  require_absent: options?.requireAbsent,
                })
              : await patchStorageOpsBucketUiTags({
                  targets: batch.map((target) =>
                    target.contextId
                      ? { context_id: target.contextId, name: target.name }
                      : { endpoint_id: target.endpointId, tenant: target.tenant ?? "", name: target.name }
                  ),
                  add_tag_ids: addTagIds,
                  create_tags: createTags.map(({ visibility: _visibility, ...tag }) => tag),
                  remove_tag_ids: remove.map((tag) => tag.id),
                  remove_all: options?.removeAll,
                  require_absent: options?.requireAbsent,
                });
          completed += batch.length;
          options?.onProgress?.({ completed, total: targets.length });
        }
        setCatalog(nextCatalog);
        setLoadedScopeKey(catalogScopeKey);
        onMutated?.();
      } catch (err) {
        if (completed > 0) {
          // Earlier batches are already committed by the backend. Keep the
          // local catalog aligned with that partial success before surfacing
          // the failing batch.
          setCatalog(nextCatalog);
          setLoadedScopeKey(catalogScopeKey);
          onMutated?.();
        }
        setError(err instanceof Error ? err.message : "Unable to update bucket UI tags.");
        throw err;
      } finally {
        setMutating(false);
      }
    },
    [catalog, catalogScopeKey, mode, onMutated, selectedEndpointId]
  );

  const removeTargets = useCallback(
    async (targetKeys: string[]) => {
      const targets = targetKeys
        .map((key) => entries[key]?.target)
        .filter((target): target is BucketUiTagTarget => Boolean(target));
      await applyTags(targets, [], [], { removeAll: true, requireAbsent: true });
    },
    [applyTags, entries]
  );

  const ready = loadedScopeKey === catalogScopeKey && !loading && error === null;
  return { entries, tags, definitions, loading, ready, mutating, error, reload, applyTags, removeTargets };
}

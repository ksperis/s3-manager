/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchCephAdminBucketUiTagOrphans,
  fetchCephAdminBucketUiTags,
  fetchStorageOpsBucketUiTagOrphans,
  fetchStorageOpsBucketUiTags,
  patchCephAdminBucketUiTags,
  patchStorageOpsBucketUiTags,
  type BucketUiTagCatalog,
  type BucketUiTagCreate,
  type BucketUiTagDefinition,
  type BucketUiTagOrphans,
  type BucketUiTagVisibility,
} from "../../api/bucketUiTags";
import type { BucketOpsMode } from "./bucketOpsSurface";

const STATE_KEY_SEPARATOR = "\u001e";
const MUTATION_BATCH_SIZE = 200;
const EMPTY_BUCKET_UI_TAG_CATALOG: BucketUiTagCatalog = { definitions: [] };
const EMPTY_BUCKET_UI_TAG_ORPHANS: BucketUiTagOrphans = { orphans: [] };

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

const orphanEntries = (mode: BucketOpsMode, response: BucketUiTagOrphans): Record<string, BucketUiTagEntry> => {
  const entries: Record<string, BucketUiTagEntry> = {};
  response.orphans.forEach((orphan) => {
    const { endpoint_id: endpointId, tenant, name } = orphan.target;
    const identity =
      mode === "storage-ops"
        ? buildPhysicalBucketUiTagIdentity(endpointId, tenant, name)
        : `${tenant ? `${tenant}/` : ""}${name}`;
    const target = createBucketUiTagTarget(mode, endpointId, identity, name, tenant);
    if (!target) return;
    if (orphan.tags.length > 0) entries[target.key] = { target, tags: orphan.tags };
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
  const [catalog, setCatalog] = useState<BucketUiTagCatalog>(EMPTY_BUCKET_UI_TAG_CATALOG);
  const [orphans, setOrphans] = useState<BucketUiTagOrphans>(EMPTY_BUCKET_UI_TAG_ORPHANS);
  const [loading, setLoading] = useState(true);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const refreshOrphans = useCallback((requestId: number) => {
    const request = mode === "ceph-admin"
      ? fetchCephAdminBucketUiTagOrphans(Number(selectedEndpointId))
      : fetchStorageOpsBucketUiTagOrphans();
    void request
      .then((nextOrphans) => {
        if (requestId === requestSequenceRef.current) setOrphans(nextOrphans);
      })
      .catch((orphanError: unknown) => {
        if (requestId === requestSequenceRef.current) setOrphans(EMPTY_BUCKET_UI_TAG_ORPHANS);
        console.warn("Unable to validate UI tags against bucket inventory.", orphanError);
      });
  }, [mode, selectedEndpointId]);

  const reload = useCallback(async () => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    if (mode === "ceph-admin" && !selectedEndpointId) {
      setCatalog(EMPTY_BUCKET_UI_TAG_CATALOG);
      setOrphans(EMPTY_BUCKET_UI_TAG_ORPHANS);
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
    refreshOrphans(requestId);
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
  }, [catalogScopeKey, mode, refreshOrphans, selectedEndpointId]);

  useEffect(() => {
    void reload();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [reload]);

  // Do not expose the previous endpoint's definitions or orphan observations
  // while a new Ceph Admin scope is loading or has failed to load.
  const visibleCatalog = loadedScopeKey === catalogScopeKey ? catalog : EMPTY_BUCKET_UI_TAG_CATALOG;
  const visibleOrphans = loadedScopeKey === catalogScopeKey ? orphans : EMPTY_BUCKET_UI_TAG_ORPHANS;
  const entries = useMemo(() => orphanEntries(mode, visibleOrphans), [mode, visibleOrphans]);
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
        requireAbsent?: boolean;
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
        if (requestId === requestSequenceRef.current) {
          setCatalog(nextCatalog);
          setLoadedScopeKey(catalogScopeKey);
          refreshOrphans(requestId);
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
          refreshOrphans(requestId);
        }
        throw err;
      } finally {
        if (requestId === requestSequenceRef.current) setMutating(false);
      }
    },
    [catalog, catalogScopeKey, mode, onMutated, refreshOrphans, selectedEndpointId]
  );

  const removeTargets = useCallback(
    async (targetKeys: string[]) => {
      const targets = targetKeys
        .map((key) => entries[key]?.target)
        .filter((target): target is BucketUiTagTarget => Boolean(target));
      await applyTags(targets, [], [], { removeAll: true, requireAbsent: true });
      const removedTargets = new Set(
        targets.map((target) => `${target.endpointId}${STATE_KEY_SEPARATOR}${target.tenant ?? ""}${STATE_KEY_SEPARATOR}${target.name}`)
      );
      setOrphans((current) => ({
        orphans: current.orphans.filter((orphan) =>
          !removedTargets.has(
            `${orphan.target.endpoint_id}${STATE_KEY_SEPARATOR}${orphan.target.tenant}${STATE_KEY_SEPARATOR}${orphan.target.name}`
          )
        ),
      }));
    },
    [applyTags, entries]
  );

  const ready = loadedScopeKey === catalogScopeKey && !loading && error === null;
  return { orphanEntries: entries, definitions, loading, ready, mutating, error, reload, applyTags, removeTargets };
}

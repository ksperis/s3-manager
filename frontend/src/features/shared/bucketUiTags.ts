/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { BucketOpsMode } from "./bucketOpsSurface";

const UI_TAGS_V2_PREFIX = "bucket-workbench.ui_tags.v2";
const UI_TAGS_V2_RESET_MARKER = `${UI_TAGS_V2_PREFIX}.initialized`;
const LEGACY_UI_TAG_KEYS = ["bucket-workbench.ui_tags.v1", "ceph-admin.bucket_list.ui_tags.v1"];
const LIST_STATE_KEYS = ["ceph-admin.bucket_list.state.v1", "storage-ops.bucket_list.state.v1"];
const STATE_KEY_SEPARATOR = "\u001e";

export type BucketUiTagTarget = {
  key: string;
  endpointId: number;
  identity: string;
  name: string;
  tenant: string | null;
};

type BucketUiTagEntry = {
  target: BucketUiTagTarget;
  tags: string[];
};

type PersistedBucketUiTagEntry = {
  name: string;
  tenant: string | null;
  tags: string[];
};

type EndpointUiTagStore = Record<string, PersistedBucketUiTagEntry>;

export const buildBucketUiTagsStorageKey = (mode: BucketOpsMode, endpointId: number) =>
  `${UI_TAGS_V2_PREFIX}.${mode}.${endpointId}`;

const buildBucketUiTagStateKey = (mode: BucketOpsMode, endpointId: number, identity: string) =>
  `${mode}${STATE_KEY_SEPARATOR}${endpointId}${STATE_KEY_SEPARATOR}${identity}`;

export const createBucketUiTagTarget = (
  mode: BucketOpsMode,
  endpointId: number | null | undefined,
  identity: string | null | undefined,
  name: string,
  tenant?: string | null
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
  };
};

const normalizeTags = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });
  return normalized;
};

const resetLegacyUiTagsOnce = () => {
  if (typeof window === "undefined" || localStorage.getItem(UI_TAGS_V2_RESET_MARKER) === "1") return;
  LEGACY_UI_TAG_KEYS.forEach((key) => localStorage.removeItem(key));
  LIST_STATE_KEYS.forEach((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      Object.values(parsed).forEach((value) => {
        if (!value || typeof value !== "object") return;
        value.tagFilters = [];
        value.tagFilterMode = "any";
      });
      localStorage.setItem(key, JSON.stringify(parsed));
    } catch {
      // Keep unrelated list state untouched when it cannot be decoded.
    }
  });
  localStorage.setItem(UI_TAGS_V2_RESET_MARKER, "1");
};

const readEndpointStore = (mode: BucketOpsMode, endpointId: number): EndpointUiTagStore => {
  try {
    const raw = localStorage.getItem(buildBucketUiTagsStorageKey(mode, endpointId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const cleaned: EndpointUiTagStore = {};
    Object.entries(parsed).forEach(([identity, value]) => {
      if (!value || typeof value !== "object") return;
      const entry = value as Partial<PersistedBucketUiTagEntry>;
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const tags = normalizeTags(entry.tags);
      if (!identity.trim() || !name || tags.length === 0) return;
      cleaned[identity] = {
        name,
        tenant: typeof entry.tenant === "string" && entry.tenant.trim() ? entry.tenant.trim() : null,
        tags,
      };
    });
    return cleaned;
  } catch {
    return {};
  }
};

const endpointIdsForMode = (mode: BucketOpsMode, selectedEndpointId?: number | null): number[] => {
  if (mode === "ceph-admin") return selectedEndpointId ? [selectedEndpointId] : [];
  const prefix = `${UI_TAGS_V2_PREFIX}.${mode}.`;
  const ids = new Set<number>();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const endpointId = Number(key.slice(prefix.length));
    if (Number.isInteger(endpointId) && endpointId > 0) ids.add(endpointId);
  }
  return Array.from(ids);
};

const loadEntries = (mode: BucketOpsMode, selectedEndpointId?: number | null): Record<string, BucketUiTagEntry> => {
  if (typeof window === "undefined") return {};
  const entries: Record<string, BucketUiTagEntry> = {};
  endpointIdsForMode(mode, selectedEndpointId).forEach((endpointId) => {
    Object.entries(readEndpointStore(mode, endpointId)).forEach(([identity, persisted]) => {
      const target = createBucketUiTagTarget(mode, endpointId, identity, persisted.name, persisted.tenant);
      if (!target) return;
      entries[target.key] = { target, tags: persisted.tags };
    });
  });
  return entries;
};

export function useBucketUiTags(mode: BucketOpsMode, selectedEndpointId?: number | null) {
  const [entries, setEntries] = useState<Record<string, BucketUiTagEntry>>(() => {
    resetLegacyUiTagsOnce();
    return loadEntries(mode, selectedEndpointId);
  });

  const reload = useCallback(() => {
    setEntries(loadEntries(mode, selectedEndpointId));
  }, [mode, selectedEndpointId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const modePrefix = `${UI_TAGS_V2_PREFIX}.${mode}.`;
    const activeKey = selectedEndpointId ? buildBucketUiTagsStorageKey(mode, selectedEndpointId) : null;
    const handleStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (mode === "ceph-admin" ? event.key === activeKey : event.key.startsWith(modePrefix)) reload();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [mode, reload, selectedEndpointId]);

  const applyTags = useCallback(
    (targets: BucketUiTagTarget[], add: string[], remove: string[]) => {
      const normalizedAdd = normalizeTags(add);
      const removeSet = new Set(normalizeTags(remove).map((tag) => tag.toLowerCase()));
      const targetsByEndpoint = new Map<number, BucketUiTagTarget[]>();
      targets.forEach((target) => {
        const group = targetsByEndpoint.get(target.endpointId) ?? [];
        group.push(target);
        targetsByEndpoint.set(target.endpointId, group);
      });
      targetsByEndpoint.forEach((endpointTargets, endpointId) => {
        const store = readEndpointStore(mode, endpointId);
        endpointTargets.forEach((target) => {
          const current = store[target.identity]?.tags ?? [];
          const merged = normalizeTags([...current, ...normalizedAdd]).filter(
            (tag) => !removeSet.has(tag.toLowerCase())
          );
          if (merged.length === 0) {
            delete store[target.identity];
          } else {
            store[target.identity] = { name: target.name, tenant: target.tenant, tags: merged };
          }
        });
        localStorage.setItem(buildBucketUiTagsStorageKey(mode, endpointId), JSON.stringify(store));
      });
      reload();
    },
    [mode, reload]
  );

  const removeTargets = useCallback(
    (targetKeys: string[]) => {
      const targets = targetKeys.map((key) => entries[key]?.target).filter((target): target is BucketUiTagTarget => Boolean(target));
      const byEndpoint = new Map<number, BucketUiTagTarget[]>();
      targets.forEach((target) => byEndpoint.set(target.endpointId, [...(byEndpoint.get(target.endpointId) ?? []), target]));
      byEndpoint.forEach((endpointTargets, endpointId) => {
        const store = readEndpointStore(mode, endpointId);
        endpointTargets.forEach((target) => delete store[target.identity]);
        localStorage.setItem(buildBucketUiTagsStorageKey(mode, endpointId), JSON.stringify(store));
      });
      reload();
    },
    [entries, mode, reload]
  );

  const tags = useMemo(
    () => Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry.tags])) as Record<string, string[]>,
    [entries]
  );

  return { entries, tags, applyTags, removeTargets };
}


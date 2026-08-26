/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchBrowserObjectColumns,
  type BrowserRequestOptions,
} from "../../api/browser";
import {
  createLazyColumnCacheEntry,
  type LazyColumnCacheEntry,
} from "./browserObjectTableModel";
import type { BrowserItem } from "./browserTypes";

const LAZY_COLUMN_CONCURRENCY = 4;
const LAZY_COLUMN_BATCH_SIZE = 24;
const LAZY_COLUMN_ROOT_MARGIN = "200px";

type LazyColumnLoadPlan = {
  key: string;
  loadMetadata: boolean;
  loadTags: boolean;
};

type UseBrowserLazyColumnsOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  enabled: boolean;
  items: BrowserItem[];
  metadataColumnsVisible: boolean;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
  sseCustomerKeyBase64: string | null;
  tagsColumnVisible: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
};

export function useBrowserLazyColumns({
  accountId,
  bucketName,
  enabled,
  items,
  metadataColumnsVisible,
  prefix,
  requestOptions,
  sseCustomerKeyBase64,
  tagsColumnVisible,
  viewportRef,
}: UseBrowserLazyColumnsOptions) {
  const [cache, setCache] = useState<Record<string, LazyColumnCacheEntry>>({});
  const cacheRef = useRef<Record<string, LazyColumnCacheEntry>>({});
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const itemsByIdRef = useRef(itemsById);
  const queueRef = useRef<string[]>([]);
  const queuedIdsRef = useRef(new Set<string>());
  const inFlightRef = useRef(0);
  const sessionRef = useRef(0);
  const active = metadataColumnsVisible || tagsColumnVisible;
  const scopeKey = JSON.stringify([
    accountId ?? null,
    bucketName,
    enabled,
    prefix,
    requestOptions?.workspaceSurface ?? null,
    sseCustomerKeyBase64,
  ]);

  useEffect(() => {
    sessionRef.current += 1;
    cacheRef.current = {};
    queueRef.current = [];
    queuedIdsRef.current.clear();
    inFlightRef.current = 0;
    setCache({});
  }, [scopeKey]);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    itemsByIdRef.current = itemsById;
  }, [itemsById]);

  useEffect(() => {
    const itemIds = new Set(items.map((item) => item.id));
    setCache((previous) => {
      let changed = false;
      const next: Record<string, LazyColumnCacheEntry> = {};
      Object.entries(previous).forEach(([itemId, entry]) => {
        if (itemIds.has(itemId)) {
          next[itemId] = entry;
        } else {
          changed = true;
        }
      });
      return changed ? next : previous;
    });
    if (queueRef.current.length > 0) {
      const filteredQueue = queueRef.current.filter((itemId) =>
        itemIds.has(itemId),
      );
      if (filteredQueue.length !== queueRef.current.length) {
        queueRef.current = filteredQueue;
        queuedIdsRef.current = new Set(filteredQueue);
      }
    }
  }, [items]);

  const markLoadErrors = useCallback(
    (loadPlan: Map<string, LazyColumnLoadPlan>, session: number) => {
      if (session !== sessionRef.current) return;
      setCache((previous) => {
        const next = { ...previous };
        loadPlan.forEach((plan, itemId) => {
          const currentItem = itemsByIdRef.current.get(itemId);
          const entry = next[itemId];
          if (!entry || !currentItem || currentItem.key !== plan.key) return;
          next[itemId] = {
            ...entry,
            metadataStatus:
              plan.loadMetadata && entry.metadataStatus === "loading"
                ? "error"
                : entry.metadataStatus,
            tagsStatus:
              plan.loadTags && entry.tagsStatus === "loading"
                ? "error"
                : entry.tagsStatus,
          };
        });
        return next;
      });
    },
    [],
  );

  const loadItems = useCallback(
    async (itemIds: string[], session: number) => {
      if (session !== sessionRef.current) return;
      const batchIds = Array.from(new Set(itemIds));
      if (batchIds.length === 0) return;

      const loadPlan = new Map<string, LazyColumnLoadPlan>();
      batchIds.forEach((itemId) => {
        const item = itemsByIdRef.current.get(itemId);
        if (!item || item.type !== "file" || item.isDeleted) return;
        const currentEntry =
          cacheRef.current[itemId] ?? createLazyColumnCacheEntry();
        const loadMetadata =
          metadataColumnsVisible &&
          (currentEntry.metadataStatus === "loading" ||
            currentEntry.metadataStatus === "idle");
        const loadTags =
          tagsColumnVisible &&
          (currentEntry.tagsStatus === "loading" ||
            currentEntry.tagsStatus === "idle");
        if (!loadMetadata && !loadTags) return;
        loadPlan.set(itemId, { key: item.key, loadMetadata, loadTags });
      });
      if (loadPlan.size === 0) return;

      if (!bucketName || !enabled) {
        markLoadErrors(loadPlan, session);
        return;
      }

      const requestedColumns: Array<
        | "content_type"
        | "tags_count"
        | "metadata_count"
        | "cache_control"
        | "expires"
        | "restore_status"
      > = [];
      if (Array.from(loadPlan.values()).some((plan) => plan.loadMetadata)) {
        requestedColumns.push(
          "content_type",
          "metadata_count",
          "cache_control",
          "expires",
          "restore_status",
        );
      }
      if (Array.from(loadPlan.values()).some((plan) => plan.loadTags)) {
        requestedColumns.push("tags_count");
      }

      try {
        const response = await fetchBrowserObjectColumns(
          accountId,
          bucketName,
          {
            keys: Array.from(
              new Set(Array.from(loadPlan.values()).map((plan) => plan.key)),
            ),
            columns: requestedColumns,
          },
          {
            sseCustomerKeyBase64,
            ...requestOptions,
          },
        );
        if (session !== sessionRef.current) return;

        const valuesByKey = new Map(
          response.items.map((entry) => [entry.key, entry]),
        );
        setCache((previous) => {
          const next = { ...previous };
          loadPlan.forEach((plan, itemId) => {
            const currentItem = itemsByIdRef.current.get(itemId);
            if (!currentItem || currentItem.key !== plan.key) return;
            const entry = next[itemId] ?? createLazyColumnCacheEntry();
            const values = valuesByKey.get(plan.key);
            let nextEntry = entry;

            if (plan.loadMetadata) {
              nextEntry =
                values?.metadata_status === "ready"
                  ? {
                      ...nextEntry,
                      contentType: values.content_type ?? null,
                      metadataCount: values.metadata_count ?? 0,
                      cacheControl: values.cache_control ?? null,
                      expires: values.expires ?? null,
                      restoreStatus: values.restore_status ?? null,
                      metadataStatus: "ready",
                    }
                  : { ...nextEntry, metadataStatus: "error" };
            }
            if (plan.loadTags) {
              nextEntry =
                values?.tags_status === "ready"
                  ? {
                      ...nextEntry,
                      tagsCount: values.tags_count ?? 0,
                      tagsStatus: "ready",
                    }
                  : { ...nextEntry, tagsStatus: "error" };
            }
            next[itemId] = nextEntry;
          });
          return next;
        });
      } catch {
        markLoadErrors(loadPlan, session);
      }
    },
    [
      accountId,
      bucketName,
      enabled,
      markLoadErrors,
      metadataColumnsVisible,
      requestOptions,
      sseCustomerKeyBase64,
      tagsColumnVisible,
    ],
  );

  const drainQueue = useCallback(() => {
    const session = sessionRef.current;
    while (inFlightRef.current < LAZY_COLUMN_CONCURRENCY) {
      const nextItemIds = queueRef.current.splice(0, LAZY_COLUMN_BATCH_SIZE);
      if (nextItemIds.length === 0) return;
      nextItemIds.forEach((itemId) => queuedIdsRef.current.delete(itemId));
      inFlightRef.current += 1;
      void loadItems(nextItemIds, session)
        .catch(() => undefined)
        .finally(() => {
          if (session !== sessionRef.current) return;
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
          drainQueue();
        });
    }
  }, [loadItems]);

  const scheduleLoad = useCallback(
    (itemId: string) => {
      if (!active) return;
      const item = itemsByIdRef.current.get(itemId);
      if (!item || item.type !== "file" || item.isDeleted) return;

      const currentEntry =
        cacheRef.current[itemId] ?? createLazyColumnCacheEntry();
      const shouldLoadMetadata =
        metadataColumnsVisible && currentEntry.metadataStatus === "idle";
      const shouldLoadTags =
        tagsColumnVisible && currentEntry.tagsStatus === "idle";
      if (!shouldLoadMetadata && !shouldLoadTags) return;

      let nextEntry = currentEntry;
      if (shouldLoadMetadata) {
        nextEntry = { ...nextEntry, metadataStatus: "loading" };
      }
      if (shouldLoadTags) {
        nextEntry = { ...nextEntry, tagsStatus: "loading" };
      }
      cacheRef.current = { ...cacheRef.current, [itemId]: nextEntry };
      setCache((previous) => ({ ...previous, [itemId]: nextEntry }));

      if (!queuedIdsRef.current.has(itemId)) {
        queuedIdsRef.current.add(itemId);
        queueRef.current.push(itemId);
      }
      drainQueue();
    },
    [active, drainQueue, metadataColumnsVisible, tagsColumnVisible],
  );

  useEffect(() => {
    if (!active) return;
    const root = viewportRef.current;
    if (!root) return;
    const rowNodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-lazy-item-id]"),
    );
    if (rowNodes.length === 0) return;

    const rootRect = root.getBoundingClientRect();
    const rootMarginPx = Number.parseInt(LAZY_COLUMN_ROOT_MARGIN, 10) || 0;
    const viewportTop = rootRect.top - rootMarginPx;
    const viewportBottom = rootRect.bottom + rootMarginPx;
    rowNodes.forEach((node) => {
      const itemId = node.dataset.lazyItemId;
      if (!itemId) return;
      if (rootRect.height <= 0 || rootRect.width <= 0) {
        scheduleLoad(itemId);
        return;
      }
      const rowRect = node.getBoundingClientRect();
      if (rowRect.bottom >= viewportTop && rowRect.top <= viewportBottom) {
        scheduleLoad(itemId);
      }
    });

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      rowNodes.forEach((node) => {
        const itemId = node.dataset.lazyItemId;
        if (itemId) scheduleLoad(itemId);
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const itemId = (entry.target as HTMLElement).dataset.lazyItemId;
          if (itemId) scheduleLoad(itemId);
          observer.unobserve(entry.target);
        });
      },
      { root, rootMargin: LAZY_COLUMN_ROOT_MARGIN },
    );
    rowNodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [active, items, scheduleLoad, viewportRef]);

  return cache;
}

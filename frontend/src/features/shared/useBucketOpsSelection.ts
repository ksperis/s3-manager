/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CephAdminBucket,
  ListCephAdminBucketsParams,
} from "../../api/cephAdmin";
import type { ActionProgressState } from "./actionProgress";
import type { TextMatchMode } from "./bucketOpsAdvancedFilterModel";
import { loadBucketOpsFilteredBuckets } from "./bucketOpsFilteredBucketLoader";
import type { SortField } from "./bucketOpsListState";
import { buildBucketOpsSelectionProjection } from "./bucketOpsSelectionModel";

type BucketOpsSelectionListBuckets = (
  scopeId: number,
  params: ListCephAdminBucketsParams,
) => Promise<{
  items?: CephAdminBucket[];
  has_next: boolean;
  total?: number;
}>;

type UseBucketOpsSelectionOptions = {
  advancedFilterParam?: string;
  extractError: (error: unknown) => string;
  filterValue: string;
  isStorageOps: boolean;
  items: readonly CephAdminBucket[];
  listBuckets: BucketOpsSelectionListBuckets;
  quickFilterMode: TextMatchMode;
  scopeId: number | null;
  setError: (message: string) => void;
  sort: { field: SortField; direction: "asc" | "desc" };
  tagFilters: readonly number[];
  tagFilterMode: "any" | "all";
  total: number;
  withStats: boolean;
};

export function useBucketOpsSelection({
  advancedFilterParam,
  extractError,
  filterValue,
  isStorageOps,
  items,
  listBuckets,
  quickFilterMode,
  scopeId,
  setError,
  sort,
  tagFilters,
  tagFilterMode,
  total,
  withStats,
}: UseBucketOpsSelectionOptions) {
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(
    () => new Set(),
  );
  const [allFilteredBucketNames, setAllFilteredBucketNames] = useState<
    string[] | null
  >(null);
  const [allFilteredBucketNamesKey, setAllFilteredBucketNamesKey] = useState<
    string | null
  >(null);
  const [selectAllProgress, setSelectAllProgress] =
    useState<ActionProgressState | null>(null);
  const selectionHeaderRef = useRef<HTMLInputElement | null>(null);
  const selectionRunRef = useRef(0);
  const cachedBucketNamesRef = useRef<string[] | null>(null);
  const cachedBucketNamesKeyRef = useRef<string | null>(null);

  const selectionQueryKey = useMemo(
    () =>
      JSON.stringify({
        endpoint: scopeId,
        filter: filterValue.trim() || null,
        quickFilterMode,
        advanced: advancedFilterParam || null,
        uiTagIds: tagFilters,
        uiTagMatch: tagFilterMode,
        withStats,
      }),
    [
      advancedFilterParam,
      filterValue,
      quickFilterMode,
      scopeId,
      tagFilterMode,
      tagFilters,
      withStats,
    ],
  );

  const invalidateResolvedNames = useCallback(() => {
    cachedBucketNamesRef.current = null;
    cachedBucketNamesKeyRef.current = null;
    setAllFilteredBucketNames(null);
    setAllFilteredBucketNamesKey(null);
  }, []);

  const invalidateSelectionCache = useCallback(() => {
    selectionRunRef.current += 1;
    invalidateResolvedNames();
    setSelectAllProgress(null);
  }, [invalidateResolvedNames]);

  useEffect(() => {
    invalidateSelectionCache();
    return () => {
      selectionRunRef.current += 1;
    };
  }, [invalidateSelectionCache, selectionQueryKey]);

  useEffect(() => {
    if (
      allFilteredBucketNamesKey !== selectionQueryKey ||
      !allFilteredBucketNames ||
      total === allFilteredBucketNames.length
    ) {
      return;
    }
    invalidateResolvedNames();
  }, [
    allFilteredBucketNames,
    allFilteredBucketNamesKey,
    invalidateResolvedNames,
    selectionQueryKey,
    total,
  ]);

  const resetSelectedBuckets = useCallback(() => {
    selectionRunRef.current += 1;
    setSelectedBuckets(new Set());
    setSelectAllProgress(null);
  }, []);

  const toggleSelection = useCallback((name: string) => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const loadAllFilteredBucketNames = useCallback(
    async (
      runToken: number,
      onProgress: (completed: number, progressTotal: number) => void,
    ) => {
      if (scopeId === null) return [];
      if (
        cachedBucketNamesKeyRef.current === selectionQueryKey &&
        cachedBucketNamesRef.current
      ) {
        const cachedNames = cachedBucketNamesRef.current;
        onProgress(cachedNames.length, cachedNames.length);
        return cachedNames;
      }

      const bucketsByName = await loadBucketOpsFilteredBuckets({
        initialTotal: total > 0 ? total : null,
        listBuckets,
        onProgress: (completed, progressTotal) => {
          if (selectionRunRef.current === runToken) {
            onProgress(completed, progressTotal);
          }
        },
        params: {
          filter: filterValue.trim() || undefined,
          advanced_filter: advancedFilterParam,
          sort_by: sort.field,
          sort_dir: sort.direction,
          with_stats: withStats,
          ui_tag_ids: tagFilters.length > 0 ? [...tagFilters] : undefined,
          ui_tag_match: tagFilterMode,
        },
        scopeId,
      });
      const resolvedNames = Array.from(bucketsByName.keys());
      if (selectionRunRef.current === runToken) {
        cachedBucketNamesRef.current = resolvedNames;
        cachedBucketNamesKeyRef.current = selectionQueryKey;
        setAllFilteredBucketNames(resolvedNames);
        setAllFilteredBucketNamesKey(selectionQueryKey);
      }
      return resolvedNames;
    },
    [
      advancedFilterParam,
      filterValue,
      listBuckets,
      scopeId,
      selectionQueryKey,
      sort.direction,
      sort.field,
      tagFilterMode,
      tagFilters,
      total,
      withStats,
    ],
  );

  const setSelectionForFilteredResults = useCallback(
    async (checked: boolean) => {
      if (scopeId === null) return;
      const runToken = selectionRunRef.current + 1;
      selectionRunRef.current = runToken;
      setSelectAllProgress({
        label: checked
          ? "Selecting filtered buckets"
          : "Clearing filtered selection",
        completed: 0,
        total: Math.max(total, 0),
        failed: 0,
      });
      try {
        const names = await loadAllFilteredBucketNames(
          runToken,
          (completed, progressTotal) => {
            setSelectAllProgress((current) =>
              current
                ? { ...current, completed, total: progressTotal }
                : current,
            );
          },
        );
        if (selectionRunRef.current !== runToken) return;
        setSelectedBuckets((current) => {
          const next = new Set(current);
          names.forEach((name) => {
            if (checked) {
              next.add(name);
            } else {
              next.delete(name);
            }
          });
          return next;
        });
      } catch (error) {
        if (selectionRunRef.current === runToken) {
          setError(extractError(error));
        }
      } finally {
        if (selectionRunRef.current === runToken) {
          setSelectAllProgress(null);
        }
      }
    },
    [extractError, loadAllFilteredBucketNames, scopeId, setError, total],
  );

  const projection = useMemo(
    () =>
      buildBucketOpsSelectionProjection({
        allFilteredBucketNames,
        allFilteredBucketNamesKey,
        isStorageOps,
        items,
        selectedBuckets,
        selectionQueryKey,
        total,
      }),
    [
      allFilteredBucketNames,
      allFilteredBucketNamesKey,
      isStorageOps,
      items,
      selectedBuckets,
      selectionQueryKey,
      total,
    ],
  );

  useEffect(() => {
    if (selectionHeaderRef.current) {
      selectionHeaderRef.current.indeterminate = projection.headerIndeterminate;
    }
  }, [projection.headerIndeterminate]);

  return {
    ...projection,
    invalidateSelectionCache,
    resetSelectedBuckets,
    selectAllLoading: selectAllProgress !== null,
    selectAllProgress,
    selectedBuckets,
    selectionHeaderRef,
    setSelectionForFilteredResults,
    toggleSelection,
  };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type {
  CephAdminBucket,
  CephAdminBucketsStreamProgress,
  ListCephAdminBucketsParams,
  PaginatedCephAdminBucketsResponse,
} from "../../api/cephAdmin";

type BucketSort = {
  field: string;
  direction: "asc" | "desc";
};

type UseBucketOpsListingParams = {
  selectedScopeId: number | null | undefined;
  page: number;
  pageSize: number;
  filterValue: string;
  advancedFilterParam?: string;
  advancedSearchEnabled: boolean;
  sort: BucketSort;
  includeParams: string[];
  requiresStats: boolean;
  baseRequiresStats: boolean;
  extractError: (err: unknown) => string;
  listBuckets: (
    scopeId: number,
    params?: ListCephAdminBucketsParams,
    options?: { signal?: AbortSignal }
  ) => Promise<PaginatedCephAdminBucketsResponse>;
  streamBuckets: (
    scopeId: number,
    params?: ListCephAdminBucketsParams,
    options?: {
      signal?: AbortSignal;
      onProgress?: (event: CephAdminBucketsStreamProgress) => void;
    }
  ) => Promise<PaginatedCephAdminBucketsResponse>;
};

export type AdvancedSearchProgress = {
  active: boolean;
  determinate: boolean;
  percent: number;
  stage: string;
  message: string;
};

type UseBucketOpsListingResult = {
  items: CephAdminBucket[];
  total: number;
  loading: boolean;
  loadingDetails: boolean;
  advancedProgress: AdvancedSearchProgress;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  refresh: () => void;
};

const bucketRowKey = (bucket: CephAdminBucket) => `${bucket.tenant ?? ""}:${bucket.name}`;
const DETAILS_FETCH_DELAY_MS = 120;
const INACTIVE_ADVANCED_PROGRESS: AdvancedSearchProgress = {
  active: false,
  determinate: true,
  percent: 0,
  stage: "",
  message: "",
};

function isCancelledError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (typeof err !== "object" || err === null) return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  return name === "CanceledError" || code === "ERR_CANCELED";
}

export function useBucketOpsListing({
  selectedScopeId,
  page,
  pageSize,
  filterValue,
  advancedFilterParam,
  advancedSearchEnabled,
  sort,
  includeParams,
  requiresStats,
  baseRequiresStats,
  extractError,
  listBuckets,
  streamBuckets,
}: UseBucketOpsListingParams): UseBucketOpsListingResult {
  const [items, setItems] = useState<CephAdminBucket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [advancedProgress, setAdvancedProgress] = useState<AdvancedSearchProgress>(INACTIVE_ADVANCED_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const refresh = useCallback(() => {
    setReloadNonce((prev) => prev + 1);
  }, []);

  const fetchBuckets = useCallback(async () => {
    if (!selectedScopeId) return;

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    requestAbortRef.current?.abort();
    const requestAbort = new AbortController();
    requestAbortRef.current = requestAbort;

    setLoading(true);
    setLoadingDetails(false);
    setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
    setError(null);

    try {
      const baseParams = {
        page,
        page_size: pageSize,
        filter: filterValue.trim() || undefined,
        advanced_filter: advancedFilterParam,
        sort_by: sort.field,
        sort_dir: sort.direction,
        with_stats: baseRequiresStats,
      };
      const canUseAdvancedStream =
        advancedSearchEnabled &&
        typeof advancedFilterParam === "string" &&
        advancedFilterParam.trim().startsWith("{");

      let baseResponse;
      if (canUseAdvancedStream) {
        setAdvancedProgress({
          active: true,
          determinate: true,
          percent: 0,
          stage: "prepare",
          message: "Preparing advanced search...",
        });
        try {
          baseResponse = await streamBuckets(selectedScopeId, baseParams, {
            signal: requestAbort.signal,
            onProgress: (event: CephAdminBucketsStreamProgress) => {
              if (requestId !== requestSeqRef.current || requestAbort.signal.aborted) return;
              const rawPercent = Number(event.percent);
              const percent = Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, Math.round(rawPercent))) : 0;
              setAdvancedProgress({
                active: true,
                determinate: true,
                percent,
                stage: event.stage || "",
                message: event.message || "Running advanced search...",
              });
            },
          });
        } catch (streamErr) {
          if (isCancelledError(streamErr)) return;
          if (requestId !== requestSeqRef.current) return;
          setAdvancedProgress({
            active: true,
            determinate: false,
            percent: 0,
            stage: "fallback",
            message: "Advanced search in progress...",
          });
          baseResponse = await listBuckets(selectedScopeId, baseParams, { signal: requestAbort.signal });
        }
      } else {
        baseResponse = await listBuckets(selectedScopeId, baseParams, { signal: requestAbort.signal });
      }

      if (requestAbort.signal.aborted) return;
      if (requestId !== requestSeqRef.current) return;

      const baseItems = baseResponse.items ?? [];
      setItems(baseItems);
      setTotal(baseResponse.total ?? 0);
      setLoading(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);

      const needsDetails = includeParams.length > 0 || (requiresStats && !baseRequiresStats);
      if (!needsDetails || baseItems.length === 0) return;

      setLoadingDetails(true);
      try {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, DETAILS_FETCH_DELAY_MS);
        });
        if (requestAbort.signal.aborted) return;
        if (requestId !== requestSeqRef.current) return;

        const detailResponse = await listBuckets(
          selectedScopeId,
          {
            page,
            page_size: pageSize,
            filter: filterValue.trim() || undefined,
            advanced_filter: advancedFilterParam,
            sort_by: sort.field,
            sort_dir: sort.direction,
            include: includeParams.length > 0 ? includeParams : undefined,
            with_stats: requiresStats,
          },
          { signal: requestAbort.signal }
        );
        if (requestAbort.signal.aborted) return;
        if (requestId !== requestSeqRef.current) return;

        const detailsByKey = new Map((detailResponse.items ?? []).map((bucket) => [bucketRowKey(bucket), bucket]));
        setItems(baseItems.map((bucket) => detailsByKey.get(bucketRowKey(bucket)) ?? bucket));
      } finally {
        if (requestId === requestSeqRef.current) {
          setLoadingDetails(false);
        }
      }
    } catch (err) {
      if (isCancelledError(err)) return;
      if (requestId !== requestSeqRef.current) return;
      console.error(err);
      setError(extractError(err));
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingDetails(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
    }
  }, [
    selectedScopeId,
    page,
    pageSize,
    filterValue,
    advancedFilterParam,
    advancedSearchEnabled,
    sort.field,
    sort.direction,
    includeParams,
    requiresStats,
    baseRequiresStats,
    extractError,
    listBuckets,
    streamBuckets,
  ]);

  useEffect(() => {
    if (!selectedScopeId) {
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingDetails(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
      return;
    }
    void fetchBuckets();
  }, [selectedScopeId, fetchBuckets, reloadNonce]);

  useEffect(() => {
    return () => {
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, []);

  return {
    items,
    total,
    loading,
    loadingDetails,
    advancedProgress,
    error,
    setError,
    refresh,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { CephAdminBucket, listCephAdminBuckets } from "../../api/cephAdmin";

type BucketSort = {
  field: string;
  direction: "asc" | "desc";
};

type UseCephAdminBucketListingParams = {
  selectedEndpointId: number | null | undefined;
  page: number;
  pageSize: number;
  filterValue: string;
  advancedFilterParam?: string;
  sort: BucketSort;
  includeParams: string[];
  requiresStats: boolean;
  baseRequiresStats: boolean;
  extractError: (err: unknown) => string;
};

type UseCephAdminBucketListingResult = {
  items: CephAdminBucket[];
  total: number;
  loading: boolean;
  loadingDetails: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  refresh: () => void;
};

const bucketRowKey = (bucket: CephAdminBucket) => `${bucket.tenant ?? ""}:${bucket.name}`;

export function useCephAdminBucketListing({
  selectedEndpointId,
  page,
  pageSize,
  filterValue,
  advancedFilterParam,
  sort,
  includeParams,
  requiresStats,
  baseRequiresStats,
  extractError,
}: UseCephAdminBucketListingParams): UseCephAdminBucketListingResult {
  const [items, setItems] = useState<CephAdminBucket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  const refresh = useCallback(() => {
    setReloadNonce((prev) => prev + 1);
  }, []);

  const fetchBuckets = useCallback(async () => {
    if (!selectedEndpointId) return;

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;

    setLoading(true);
    setLoadingDetails(false);
    setError(null);

    try {
      const baseResponse = await listCephAdminBuckets(selectedEndpointId, {
        page,
        page_size: pageSize,
        filter: filterValue.trim() || undefined,
        advanced_filter: advancedFilterParam,
        sort_by: sort.field,
        sort_dir: sort.direction,
        with_stats: baseRequiresStats,
      });
      if (requestId !== requestSeqRef.current) return;

      const baseItems = baseResponse.items ?? [];
      setItems(baseItems);
      setTotal(baseResponse.total ?? 0);
      setLoading(false);

      const needsDetails = includeParams.length > 0 || (requiresStats && !baseRequiresStats);
      if (!needsDetails || baseItems.length === 0) return;

      setLoadingDetails(true);
      try {
        const detailResponse = await listCephAdminBuckets(selectedEndpointId, {
          page,
          page_size: pageSize,
          filter: filterValue.trim() || undefined,
          advanced_filter: advancedFilterParam,
          sort_by: sort.field,
          sort_dir: sort.direction,
          include: includeParams.length > 0 ? includeParams : undefined,
          with_stats: requiresStats,
        });
        if (requestId !== requestSeqRef.current) return;

        const detailsByKey = new Map((detailResponse.items ?? []).map((bucket) => [bucketRowKey(bucket), bucket]));
        setItems(baseItems.map((bucket) => detailsByKey.get(bucketRowKey(bucket)) ?? bucket));
      } finally {
        if (requestId === requestSeqRef.current) {
          setLoadingDetails(false);
        }
      }
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      console.error(err);
      setError(extractError(err));
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingDetails(false);
    }
  }, [
    selectedEndpointId,
    page,
    pageSize,
    filterValue,
    advancedFilterParam,
    sort.field,
    sort.direction,
    includeParams,
    requiresStats,
    baseRequiresStats,
    extractError,
  ]);

  useEffect(() => {
    if (!selectedEndpointId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingDetails(false);
      return;
    }
    void fetchBuckets();
  }, [selectedEndpointId, fetchBuckets, reloadNonce]);

  return {
    items,
    total,
    loading,
    loadingDetails,
    error,
    setError,
    refresh,
  };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

type UseBucketOpsCacheRefreshOptions = {
  clearTagTooltip: () => void;
  extractError: (error: unknown) => string;
  invalidateSelectionCache: () => void;
  refreshBucketListingCache: (scopeId: number) => Promise<unknown>;
  refreshBuckets: () => void;
  reloadUiTags: () => Promise<unknown>;
  resetBucketTooltipState: () => void;
  scopeId: number | null;
  setError: (error: string | null) => void;
};

export function useBucketOpsCacheRefresh({
  clearTagTooltip,
  extractError,
  invalidateSelectionCache,
  refreshBucketListingCache,
  refreshBuckets,
  reloadUiTags,
  resetBucketTooltipState,
  scopeId,
  setError,
}: UseBucketOpsCacheRefreshOptions) {
  const [cacheRefreshLoading, setCacheRefreshLoading] = useState(false);
  const generationRef = useRef(0);
  const activeRunRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearBucketListingUiCaches = useCallback(() => {
    resetBucketTooltipState();
    clearTagTooltip();
    invalidateSelectionCache();
  }, [clearTagTooltip, invalidateSelectionCache, resetBucketTooltipState]);

  useEffect(() => {
    generationRef.current += 1;
    if (activeRunRef.current === null) {
      setCacheRefreshLoading(false);
    }
  }, [scopeId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const refreshBucketListing = useCallback(async () => {
    if (scopeId === null || activeRunRef.current !== null) return;

    const runToken = generationRef.current + 1;
    generationRef.current = runToken;
    activeRunRef.current = runToken;
    setCacheRefreshLoading(true);
    setError(null);

    try {
      await refreshBucketListingCache(scopeId);
      if (generationRef.current !== runToken || !mountedRef.current) return;

      await reloadUiTags();
      if (generationRef.current !== runToken || !mountedRef.current) return;

      clearBucketListingUiCaches();
      refreshBuckets();
    } catch (error) {
      if (generationRef.current === runToken && mountedRef.current) {
        setError(extractError(error));
      }
    } finally {
      if (activeRunRef.current === runToken) {
        activeRunRef.current = null;
        if (mountedRef.current) {
          setCacheRefreshLoading(false);
        }
      }
    }
  }, [
    clearBucketListingUiCaches,
    extractError,
    refreshBucketListingCache,
    refreshBuckets,
    reloadUiTags,
    scopeId,
    setError,
  ]);

  return {
    cacheRefreshLoading,
    clearBucketListingUiCaches,
    refreshBucketListing,
  };
}

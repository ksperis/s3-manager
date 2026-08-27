/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

type LoadObjectsOptions = {
  prefixOverride: string;
  silent?: boolean;
  forceRefresh?: boolean;
};

type LoadObjects = (options: LoadObjectsOptions) => Promise<void>;

type LoadTreeChildren = (
  prefix: string,
  options?: { expand?: boolean },
) => Promise<void>;

type UseBrowserListingRefreshOptions = {
  bucketName: string;
  contextKey: string | null;
  enabled: boolean;
  loadObjects: LoadObjects;
  loadTreeChildren: LoadTreeChildren;
  prefix: string;
  refreshToken?: number;
};

const REFRESH_DEBOUNCE_MS = 400;

export function useBrowserListingRefresh({
  bucketName,
  contextKey,
  enabled,
  loadObjects,
  loadTreeChildren,
  prefix,
  refreshToken,
}: UseBrowserListingRefreshOptions) {
  const refreshTimeoutRef = useRef<number | null>(null);
  const refreshScopeKey = JSON.stringify([
    contextKey,
    bucketName,
    enabled,
    prefix,
  ]);
  const activeRefreshScopeRef = useRef(refreshScopeKey);
  const previousRefreshTokenRef = useRef(refreshToken);

  const cancelPendingRefresh = useCallback(() => {
    if (
      typeof window === "undefined" ||
      refreshTimeoutRef.current === null
    ) {
      return;
    }
    window.clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (activeRefreshScopeRef.current === refreshScopeKey) return;
    activeRefreshScopeRef.current = refreshScopeKey;
    cancelPendingRefresh();
  }, [cancelPendingRefresh, refreshScopeKey]);

  const refreshNow = useCallback(
    async (prefixOverride: string) => {
      await loadObjects({
        prefixOverride,
        silent: true,
        forceRefresh: true,
      });
      void loadTreeChildren(prefixOverride, { expand: false });
    },
    [loadObjects, loadTreeChildren],
  );

  const reload = useCallback(
    async (prefixOverride: string) => {
      await loadObjects({ prefixOverride });
      void loadTreeChildren(prefixOverride);
    },
    [loadObjects, loadTreeChildren],
  );

  const requestRefresh = useCallback(
    (prefixOverride: string) => {
      if (typeof window === "undefined" || !enabled || !bucketName) return;
      cancelPendingRefresh();
      const requestedScopeKey = refreshScopeKey;
      refreshTimeoutRef.current = window.setTimeout(() => {
        refreshTimeoutRef.current = null;
        if (activeRefreshScopeRef.current !== requestedScopeKey) return;
        void loadObjects({ prefixOverride, silent: true });
        void loadTreeChildren(prefixOverride, { expand: false });
      }, REFRESH_DEBOUNCE_MS);
    },
    [
      bucketName,
      cancelPendingRefresh,
      enabled,
      loadObjects,
      loadTreeChildren,
      refreshScopeKey,
    ],
  );

  const refreshAfterUpload = useCallback(
    (targetPrefix: string) => {
      void loadObjects({
        prefixOverride: targetPrefix,
        silent: true,
        forceRefresh: true,
      });
      void loadTreeChildren(targetPrefix, { expand: false });
    },
    [loadObjects, loadTreeChildren],
  );

  useEffect(() => {
    if (
      refreshToken === undefined ||
      refreshToken === previousRefreshTokenRef.current
    ) {
      return;
    }
    previousRefreshTokenRef.current = refreshToken;
    if (bucketName && enabled) {
      void refreshNow(prefix);
    }
  }, [bucketName, enabled, prefix, refreshNow, refreshToken]);

  useEffect(() => cancelPendingRefresh, [cancelPendingRefresh]);

  return {
    refreshAfterUpload,
    refreshNow,
    reload,
    requestRefresh,
  };
}

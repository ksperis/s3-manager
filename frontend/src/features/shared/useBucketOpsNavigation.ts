/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { CephAdminBucket } from "../../api/cephAdmin";
import {
  buildBucketDetailLocationState,
  loadBucketListReturnContext,
  saveBucketListReturnContext,
} from "./bucketListReturnContext";
import {
  buildBucketOpsListOrigin,
  buildBucketOpsNavigationTarget,
  type BucketOpsNavigationAction,
} from "./bucketOpsTableNavigation";
import type { BucketOpsMode } from "./bucketOpsSurface";

type UseBucketOpsNavigationOptions = {
  items: readonly CephAdminBucket[];
  loading: boolean;
  mode: BucketOpsMode;
  persistCurrentListState: () => void;
  selectedEndpointId: number | null;
};

export function useBucketOpsNavigation({
  items,
  loading,
  mode,
  persistCurrentListState,
  selectedEndpointId,
}: UseBucketOpsNavigationOptions) {
  const location = useLocation();
  const navigate = useNavigate();
  const restoredReturnContextRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading || items.length === 0 || !selectedEndpointId) return;
    const scopeKey =
      mode === "storage-ops" ? "storage-ops" : String(selectedEndpointId);
    const returnContext = loadBucketListReturnContext(mode, scopeKey);
    if (
      !returnContext ||
      returnContext.listUrl !== `${location.pathname}${location.search}`
    ) {
      return;
    }
    if (restoredReturnContextRef.current === returnContext.savedAt) return;
    restoredReturnContextRef.current = returnContext.savedAt;

    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: returnContext.scrollY, behavior: "auto" });
      const rowButton = Array.from(
        document.querySelectorAll<HTMLElement>("[data-bucket-row-key]"),
      ).find(
        (element) => element.dataset.bucketRowKey === returnContext.rowKey,
      );
      if (!rowButton) return;
      rowButton.focus({ preventScroll: true });
      const bounds = rowButton.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
        rowButton.scrollIntoView({ block: "center", behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    items,
    loading,
    location.pathname,
    location.search,
    mode,
    selectedEndpointId,
  ]);

  const navigateToBucketAction = useCallback(
    (action: BucketOpsNavigationAction, bucket: CephAdminBucket) => {
      const target = buildBucketOpsNavigationTarget({
        action,
        bucket,
        mode,
        selectedEndpointId,
      });
      if (target) navigate(target);
    },
    [mode, navigate, selectedEndpointId],
  );

  const openBucketConfiguration = useCallback(
    (bucket: CephAdminBucket) => {
      const listUrl = `${location.pathname}${location.search}`;
      const origin = buildBucketOpsListOrigin({
        listUrl,
        mode,
        selectedEndpointId,
      });
      if (!origin) return;
      persistCurrentListState();
      saveBucketListReturnContext(origin, bucket.name, window.scrollY);
      const target = buildBucketOpsNavigationTarget({
        action: "configure",
        bucket,
        mode,
        selectedEndpointId,
      });
      if (!target) return;
      navigate(target, { state: buildBucketDetailLocationState(origin) });
    },
    [
      location.pathname,
      location.search,
      mode,
      navigate,
      persistCurrentListState,
      selectedEndpointId,
    ],
  );

  return { navigateToBucketAction, openBucketConfiguration };
}

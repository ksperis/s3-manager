/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { BucketOpsMode } from "./bucketOpsSurface";

const BUCKET_LIST_RETURN_STORAGE_PREFIX = "bucket-list.return.v1";
const BUCKET_LIST_ORIGIN_STATE_KEY = "bucketListOrigin";

export type BucketListOrigin = {
  surface: BucketOpsMode;
  scopeKey: string;
  listUrl: string;
};

export type BucketListReturnContext = BucketListOrigin & {
  rowKey: string;
  scrollY: number;
  savedAt: number;
};

type BucketDetailLocationState = {
  [BUCKET_LIST_ORIGIN_STATE_KEY]?: BucketListOrigin;
};

function storageKey(surface: BucketOpsMode, scopeKey: string): string {
  return `${BUCKET_LIST_RETURN_STORAGE_PREFIX}.${surface}.${scopeKey}`;
}

function sanitizeOrigin(value: unknown): BucketListOrigin | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<BucketListOrigin>;
  if (data.surface !== "ceph-admin" && data.surface !== "storage-ops") return null;
  if (typeof data.scopeKey !== "string" || !data.scopeKey.trim()) return null;
  if (typeof data.listUrl !== "string" || !data.listUrl.startsWith("/")) return null;
  return {
    surface: data.surface,
    scopeKey: data.scopeKey,
    listUrl: data.listUrl,
  };
}

export function saveBucketListReturnContext(
  origin: BucketListOrigin,
  rowKey: string,
  scrollY: number
): BucketListReturnContext {
  const context: BucketListReturnContext = {
    ...origin,
    rowKey,
    scrollY: Number.isFinite(scrollY) && scrollY > 0 ? scrollY : 0,
    savedAt: Date.now(),
  };
  if (typeof window !== "undefined") {
    sessionStorage.setItem(storageKey(origin.surface, origin.scopeKey), JSON.stringify(context));
  }
  return context;
}

export function loadBucketListReturnContext(
  surface: BucketOpsMode,
  scopeKey: string
): BucketListReturnContext | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(storageKey(surface, scopeKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BucketListReturnContext>;
    const origin = sanitizeOrigin(parsed);
    if (!origin || origin.surface !== surface || origin.scopeKey !== scopeKey) return null;
    if (typeof parsed.rowKey !== "string" || !parsed.rowKey) return null;
    return {
      ...origin,
      rowKey: parsed.rowKey,
      scrollY: typeof parsed.scrollY === "number" && Number.isFinite(parsed.scrollY) ? Math.max(0, parsed.scrollY) : 0,
      savedAt: typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function buildBucketDetailLocationState(origin: BucketListOrigin): BucketDetailLocationState {
  return { [BUCKET_LIST_ORIGIN_STATE_KEY]: origin };
}

export function readBucketListOrigin(state: unknown, surface: BucketOpsMode): BucketListOrigin | null {
  if (!state || typeof state !== "object") return null;
  const origin = sanitizeOrigin((state as BucketDetailLocationState)[BUCKET_LIST_ORIGIN_STATE_KEY]);
  return origin?.surface === surface ? origin : null;
}

export function useBucketListBackNavigation(surface: BucketOpsMode, fallbackListUrl: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const origin = useMemo(() => readBucketListOrigin(location.state, surface), [location.state, surface]);
  const listUrl = origin?.listUrl ?? fallbackListUrl;
  const onBack = useCallback(() => {
    if (origin) {
      navigate(-1);
      return;
    }
    navigate(fallbackListUrl);
  }, [fallbackListUrl, navigate, origin]);

  return { listUrl, onBack, hasHistoryOrigin: Boolean(origin) };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  listObjectVersions,
  type BrowserObjectVersion,
  type BrowserRequestOptions,
} from "../../api/browser";
import { extractApiError } from "../../utils/apiError";
import { buildVersionRows } from "./browserUtils";

type LoadBrowserVersionsOptions = {
  append?: boolean;
  force?: boolean;
};

type UseBrowserVersionListingOptions = {
  accountId: S3AccountSelector;
  autoLoad?: boolean;
  bucketName: string;
  enabled: boolean;
  errorMessage?: string;
  hardLimit?: number;
  objectKey?: string | null;
  onHardLimit?: () => void;
  pageSize?: number;
  prefix?: string;
  requestOptions?: BrowserRequestOptions;
};

export function useBrowserVersionListing({
  accountId,
  autoLoad = false,
  bucketName,
  enabled,
  errorMessage = "Unable to load versions.",
  hardLimit,
  objectKey = null,
  onHardLimit,
  pageSize,
  prefix,
  requestOptions,
}: UseBrowserVersionListingOptions) {
  const scope = JSON.stringify([
    accountId,
    bucketName,
    enabled,
    objectKey,
    prefix ?? null,
    pageSize ?? null,
    hardLimit ?? null,
    requestOptions?.workspaceSurface ?? null,
  ]);
  const [versions, setVersions] = useState<BrowserObjectVersion[]>([]);
  const [deleteMarkers, setDeleteMarkers] = useState<BrowserObjectVersion[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyMarker, setKeyMarker] = useState<string | null>(null);
  const [versionIdMarker, setVersionIdMarker] = useState<string | null>(null);
  const versionsRef = useRef<BrowserObjectVersion[]>([]);
  const deleteMarkersRef = useRef<BrowserObjectVersion[]>([]);
  const keyMarkerRef = useRef<string | null>(null);
  const versionIdMarkerRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const scopeRef = useRef(scope);
  const onHardLimitRef = useRef(onHardLimit);
  scopeRef.current = scope;
  onHardLimitRef.current = onHardLimit;

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    versionsRef.current = [];
    deleteMarkersRef.current = [];
    keyMarkerRef.current = null;
    versionIdMarkerRef.current = null;
    loadingRef.current = false;
    setVersions([]);
    setDeleteMarkers([]);
    setLoading(false);
    setLoaded(false);
    setError(null);
    setKeyMarker(null);
    setVersionIdMarker(null);
  }, []);

  const load = useCallback(
    async ({ append = false, force = false }: LoadBrowserVersionsOptions = {}) => {
      if (scope !== scopeRef.current) return;
      if (!accountId || !bucketName || !enabled) return;
      if (objectKey === null && prefix === undefined) return;
      if (loadingRef.current && !force) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      loadingRef.current = true;
      if (!append) setError(null);
      setLoading(true);
      try {
        const target =
          objectKey !== null ? { key: objectKey } : { prefix };
        const data = await listObjectVersions(accountId, bucketName, {
          ...target,
          keyMarker: append ? keyMarkerRef.current : null,
          versionIdMarker: append ? versionIdMarkerRef.current : null,
          maxKeys: pageSize,
          requestOptions,
        });
        if (
          requestId !== requestIdRef.current ||
          scope !== scopeRef.current
        ) {
          return;
        }

        const nextVersions = append
          ? [...versionsRef.current, ...(data.versions ?? [])]
          : data.versions ?? [];
        const nextDeleteMarkers = append
          ? [...deleteMarkersRef.current, ...(data.delete_markers ?? [])]
          : data.delete_markers ?? [];
        const limitReached = Boolean(
          hardLimit &&
            (nextVersions.length > hardLimit ||
              nextDeleteMarkers.length > hardLimit),
        );
        const boundedVersions = hardLimit
          ? nextVersions.slice(0, hardLimit)
          : nextVersions;
        const boundedDeleteMarkers = hardLimit
          ? nextDeleteMarkers.slice(0, hardLimit)
          : nextDeleteMarkers;
        const nextKeyMarker = limitReached
          ? null
          : (data.next_key_marker ?? null);
        const nextVersionIdMarker = limitReached
          ? null
          : (data.next_version_id_marker ?? null);

        versionsRef.current = boundedVersions;
        deleteMarkersRef.current = boundedDeleteMarkers;
        keyMarkerRef.current = nextKeyMarker;
        versionIdMarkerRef.current = nextVersionIdMarker;
        setVersions(boundedVersions);
        setDeleteMarkers(boundedDeleteMarkers);
        setKeyMarker(nextKeyMarker);
        setVersionIdMarker(nextVersionIdMarker);
        setLoaded(true);
        if (limitReached) {
          onHardLimitRef.current?.();
        }
      } catch (loadError) {
        if (
          requestId !== requestIdRef.current ||
          scope !== scopeRef.current
        ) {
          return;
        }
        setError(extractApiError(loadError, errorMessage));
        if (!append) {
          versionsRef.current = [];
          deleteMarkersRef.current = [];
          keyMarkerRef.current = null;
          versionIdMarkerRef.current = null;
          setVersions([]);
          setDeleteMarkers([]);
          setKeyMarker(null);
          setVersionIdMarker(null);
        }
      } finally {
        if (
          requestId === requestIdRef.current &&
          scope === scopeRef.current
        ) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [
      accountId,
      bucketName,
      enabled,
      errorMessage,
      hardLimit,
      objectKey,
      pageSize,
      prefix,
      requestOptions,
      scope,
    ],
  );

  const isCurrentScope = useCallback(
    () => scope === scopeRef.current,
    [scope],
  );

  useEffect(() => reset(), [reset, scope]);

  useEffect(() => {
    if (!autoLoad || !enabled) return;
    void load();
  }, [autoLoad, enabled, load]);

  const rows = useMemo(
    () => buildVersionRows(versions, deleteMarkers),
    [deleteMarkers, versions],
  );

  return {
    canLoadMore: Boolean(keyMarker || versionIdMarker),
    error,
    isCurrentScope,
    keyMarker,
    latestRow: rows.find((row) => row.is_latest) ?? null,
    load,
    loaded,
    loading,
    rows,
    versionIdMarker,
  };
}

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

type UseBrowserObjectVersionsOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  enabled: boolean;
  objectKey: string;
  requestOptions?: BrowserRequestOptions;
};

type LoadVersionsOptions = {
  append?: boolean;
  force?: boolean;
};

export function useBrowserObjectVersions({
  accountId,
  bucketName,
  enabled,
  objectKey,
  requestOptions,
}: UseBrowserObjectVersionsOptions) {
  const scope = JSON.stringify([
    accountId,
    bucketName,
    enabled,
    objectKey,
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
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const reset = useCallback(() => {
    requestIdRef.current += 1;
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
    async ({ append = false, force = false }: LoadVersionsOptions = {}) => {
      if (scope !== scopeRef.current) return;
      if (!accountId || !bucketName || !enabled || !objectKey) return;
      if (loadingRef.current && !force) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      loadingRef.current = true;
      if (!append) setError(null);
      setLoading(true);
      try {
        const data = await listObjectVersions(accountId, bucketName, {
          key: objectKey,
          keyMarker: append ? keyMarker : null,
          versionIdMarker: append ? versionIdMarker : null,
          maxKeys: undefined,
          requestOptions,
        });
        if (requestId !== requestIdRef.current) return;
        setVersions((current) =>
          append ? [...current, ...(data.versions ?? [])] : data.versions ?? [],
        );
        setDeleteMarkers((current) =>
          append
            ? [...current, ...(data.delete_markers ?? [])]
            : data.delete_markers ?? [],
        );
        setKeyMarker(data.next_key_marker ?? null);
        setVersionIdMarker(data.next_version_id_marker ?? null);
        setLoaded(true);
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return;
        setError(extractApiError(loadError, "Unable to load versions."));
        if (!append) {
          setVersions([]);
          setDeleteMarkers([]);
          setKeyMarker(null);
          setVersionIdMarker(null);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [
      accountId,
      bucketName,
      enabled,
      keyMarker,
      objectKey,
      requestOptions,
      scope,
      versionIdMarker,
    ],
  );

  useEffect(() => reset(), [reset, scope]);

  const rows = useMemo(
    () => buildVersionRows(versions, deleteMarkers),
    [deleteMarkers, versions],
  );

  return {
    rows,
    latestRow: rows.find((row) => row.is_latest) ?? null,
    loading,
    loaded,
    error,
    canLoadMore: Boolean(keyMarker || versionIdMarker),
    load,
  };
}

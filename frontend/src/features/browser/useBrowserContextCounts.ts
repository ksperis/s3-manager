/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  listObjectVersions,
  type BrowserRequestOptions,
} from "../../api/browser";
import { VERSIONS_PAGE_SIZE } from "./browserConstants";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";

type BrowserContextCounts = {
  objects: number;
  versions: number;
  deleteMarkers: number;
};

type UseBrowserContextCountsOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  enabled: boolean;
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
  versioningEnabled: boolean;
};

async function countVersionedObjects({
  accountId,
  bucketName,
  prefix,
  requestOptions,
}: Pick<
  UseBrowserContextCountsOptions,
  "accountId" | "bucketName" | "prefix" | "requestOptions"
>): Promise<BrowserContextCounts> {
  let versions = 0;
  let deleteMarkers = 0;
  const latestDeleteStateByKey = new Map<string, boolean>();
  let keyMarker: string | null = null;
  let versionIdMarker: string | null = null;
  let isTruncated = true;
  let pageGuard = 0;

  while (isTruncated) {
    const data = await listObjectVersions(accountId, bucketName, {
      prefix,
      keyMarker: keyMarker ?? undefined,
      versionIdMarker: versionIdMarker ?? undefined,
      maxKeys: VERSIONS_PAGE_SIZE,
      requestOptions,
    });
    versions += data.versions.length;
    deleteMarkers += data.delete_markers.length;
    data.versions.forEach((version) => {
      if (version.is_latest) {
        latestDeleteStateByKey.set(version.key, false);
      }
    });
    data.delete_markers.forEach((marker) => {
      if (marker.is_latest) {
        latestDeleteStateByKey.set(marker.key, true);
      }
    });
    isTruncated = data.is_truncated;
    keyMarker = data.next_key_marker ?? null;
    versionIdMarker = data.next_version_id_marker ?? null;
    pageGuard += 1;
    if (
      !isTruncated ||
      pageGuard > 1000 ||
      (!keyMarker && !versionIdMarker)
    ) {
      break;
    }
  }

  return {
    objects: Array.from(latestDeleteStateByKey.values()).filter(
      (isDeleted) => !isDeleted,
    ).length,
    versions,
    deleteMarkers,
  };
}

export function useBrowserContextCounts({
  accountId,
  bucketName,
  enabled,
  listAllObjectsForPrefix,
  prefix,
  requestOptions,
  versioningEnabled,
}: UseBrowserContextCountsOptions) {
  const [counts, setCounts] = useState<BrowserContextCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    setCounts(null);
    setError(null);
    setLoading(false);
  }, [accountId, bucketName, enabled, prefix, versioningEnabled]);

  const count = useCallback(async () => {
    if (!bucketName || !enabled) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const nextCounts = versioningEnabled
        ? await countVersionedObjects({
            accountId,
            bucketName,
            prefix,
            requestOptions,
          })
        : {
            objects: (await listAllObjectsForPrefix(prefix)).length,
            versions: 0,
            deleteMarkers: 0,
          };
      if (requestIdRef.current !== requestId) return;
      setCounts(nextCounts);
    } catch {
      if (requestIdRef.current !== requestId) return;
      setError("Unable to count objects for this prefix.");
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [
    accountId,
    bucketName,
    enabled,
    listAllObjectsForPrefix,
    prefix,
    requestOptions,
    versioningEnabled,
  ]);

  return { count, counts, error, loading };
}

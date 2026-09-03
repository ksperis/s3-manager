/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import { listBrowserObjects } from "../../api/browser";
import {
  normalizeBrowserListingIssue,
  resolveBucketAccessEntry,
  sanitizeBucketAccessEntries,
  UNKNOWN_BUCKET_ACCESS,
  type BucketAccessEntry,
} from "./browserBucketsPanelHelpers";
import { isAbortError } from "./browserUtils";

const BUCKET_ACCESS_PROBE_CONCURRENCY = 4;

type UseBrowserBucketAccessOptions = {
  accountId: S3AccountSelector;
  activeBucketName: string;
  contextKey: string | null;
  enabled: boolean;
  requestOptions?: BrowserRequestOptions;
};

export function useBrowserBucketAccess({
  accountId,
  activeBucketName,
  contextKey,
  enabled,
  requestOptions,
}: UseBrowserBucketAccessOptions) {
  const [accessByName, setAccessByName] = useState<
    Record<string, BucketAccessEntry>
  >({});
  const accessByNameRef = useRef(accessByName);
  const cacheRef = useRef<
    Map<string, Record<string, BucketAccessEntry>>
  >(new Map());
  const activeContextKeyRef = useRef<string | null>(null);
  const queueRef = useRef<string[]>([]);
  const queuedRef = useRef(new Set<string>());
  const inFlightRef = useRef(0);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const sessionRef = useRef(0);

  const cancelProbes = useCallback(() => {
    sessionRef.current += 1;
    queueRef.current = [];
    queuedRef.current.clear();
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current.clear();
    inFlightRef.current = 0;
  }, []);

  const commitEntries = useCallback(
    (entries: Record<string, BucketAccessEntry>, persist = true) => {
      accessByNameRef.current = entries;
      if (persist && activeContextKeyRef.current) {
        cacheRef.current.set(activeContextKeyRef.current, entries);
      }
      setAccessByName(entries);
    },
    [],
  );

  const clearBucketAccessEntries = useCallback(() => {
    if (activeContextKeyRef.current !== (enabled ? contextKey : null)) return;
    commitEntries({});
  }, [commitEntries, contextKey, enabled]);

  const updateBucketAccessEntry = useCallback(
    (bucketName: string, nextEntry: BucketAccessEntry) => {
      if (
        !bucketName ||
        !enabled ||
        !contextKey ||
        activeContextKeyRef.current !== contextKey
      ) {
        return;
      }
      const normalizedNext = {
        status: nextEntry.status,
        detail: nextEntry.detail ?? null,
      } satisfies BucketAccessEntry;
      const previous = accessByNameRef.current;
      const previousEntry = previous[bucketName];
      if (
        previousEntry?.status === normalizedNext.status &&
        previousEntry?.detail === normalizedNext.detail
      ) {
        return;
      }
      commitEntries({
        ...previous,
        [bucketName]: normalizedNext,
      });
    },
    [commitEntries, contextKey, enabled],
  );

  const getBucketAccessEntry = useCallback(
    (bucketName: string) => {
      if (
        !enabled ||
        !contextKey ||
        activeContextKeyRef.current !== contextKey
      ) {
        return UNKNOWN_BUCKET_ACCESS;
      }
      return resolveBucketAccessEntry(bucketName, accessByNameRef.current);
    },
    [contextKey, enabled],
  );

  const resetBucketAccessQueue = useCallback(() => {
    if (activeContextKeyRef.current !== (enabled ? contextKey : null)) return;
    cancelProbes();
    commitEntries(sanitizeBucketAccessEntries(accessByNameRef.current));
  }, [cancelProbes, commitEntries, contextKey, enabled]);

  const drainBucketAccessQueue = useCallback(() => {
    if (!enabled || !accountId) return;
    const requestSession = sessionRef.current;
    while (
      inFlightRef.current < BUCKET_ACCESS_PROBE_CONCURRENCY &&
      queueRef.current.length > 0
    ) {
      const bucketName = queueRef.current.shift();
      if (!bucketName) continue;
      queuedRef.current.delete(bucketName);
      inFlightRef.current += 1;
      const controller = new AbortController();
      abortControllersRef.current.set(bucketName, controller);
      void listBrowserObjects(accountId, bucketName, {
        maxKeys: 1,
        signal: controller.signal,
        ...requestOptions,
      })
        .then(() => {
          if (requestSession !== sessionRef.current) return;
          updateBucketAccessEntry(bucketName, {
            status: "available",
            detail: null,
          });
        })
        .catch((error) => {
          if (isAbortError(error) || requestSession !== sessionRef.current) {
            return;
          }
          const issue = normalizeBrowserListingIssue(
            error,
            "Unable to list bucket.",
          );
          updateBucketAccessEntry(
            bucketName,
            issue.kind === "access_denied"
              ? {
                  status: "unavailable",
                  detail: issue.technicalDetail,
                }
              : UNKNOWN_BUCKET_ACCESS,
          );
        })
        .finally(() => {
          if (requestSession !== sessionRef.current) return;
          if (abortControllersRef.current.get(bucketName) !== controller) {
            return;
          }
          abortControllersRef.current.delete(bucketName);
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
          drainBucketAccessQueue();
        });
    }
  }, [accountId, enabled, requestOptions, updateBucketAccessEntry]);

  const scheduleBucketAccessProbe = useCallback(
    (bucketName: string) => {
      if (
        !bucketName ||
        !enabled ||
        !accountId ||
        bucketName === activeBucketName ||
        getBucketAccessEntry(bucketName).status !== "unknown" ||
        queuedRef.current.has(bucketName) ||
        abortControllersRef.current.has(bucketName)
      ) {
        return;
      }
      queuedRef.current.add(bucketName);
      queueRef.current.push(bucketName);
      updateBucketAccessEntry(bucketName, {
        status: "checking",
        detail: null,
      });
      drainBucketAccessQueue();
    },
    [
      accountId,
      activeBucketName,
      drainBucketAccessQueue,
      enabled,
      getBucketAccessEntry,
      updateBucketAccessEntry,
    ],
  );

  useEffect(() => {
    cancelProbes();
    const nextContextKey = enabled ? contextKey : null;
    activeContextKeyRef.current = nextContextKey;
    if (!nextContextKey) {
      commitEntries({}, false);
      return;
    }
    const cached = sanitizeBucketAccessEntries(
      cacheRef.current.get(nextContextKey) ?? {},
    );
    cacheRef.current.set(nextContextKey, cached);
    commitEntries(cached, false);
  }, [cancelProbes, commitEntries, contextKey, enabled]);

  useEffect(
    () => () => {
      activeContextKeyRef.current = null;
      cancelProbes();
    },
    [cancelProbes],
  );

  return {
    accessByName,
    clearBucketAccessEntries,
    getBucketAccessEntry,
    resetBucketAccessQueue,
    scheduleBucketAccessProbe,
    updateBucketAccessEntry,
  };
}

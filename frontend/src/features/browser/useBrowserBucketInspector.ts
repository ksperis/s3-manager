/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import { extractApiError } from "../../utils/apiError";
import {
  buildBucketInspectorFeatures,
  fetchBucketInspectorData,
  type BucketInspectorData,
} from "./browserBucketInspectorModel";

type UseBrowserBucketInspectorOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  enabled: boolean;
  includeStaticWebsite: boolean;
  includeUsage: boolean;
};

export function useBrowserBucketInspector({
  accountId,
  bucketName,
  enabled,
  includeStaticWebsite,
  includeUsage,
}: UseBrowserBucketInspectorOptions) {
  const [dataByTarget, setDataByTarget] = useState<
    Record<string, BucketInspectorData>
  >({});
  const dataByTargetRef = useRef(dataByTarget);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const inFlightTargetRef = useRef<string | null>(null);
  const requestScopeKey = JSON.stringify([
    accountId ?? null,
    enabled,
    includeStaticWebsite,
    includeUsage,
  ]);
  const requestTargetKey = `${requestScopeKey}::${bucketName}`;
  const activeRequestScopeRef = useRef(requestScopeKey);
  const activeRequestTargetRef = useRef(requestTargetKey);

  useLayoutEffect(() => {
    const scopeChanged = activeRequestScopeRef.current !== requestScopeKey;
    const targetChanged = activeRequestTargetRef.current !== requestTargetKey;
    if (!scopeChanged && !targetChanged) return;
    activeRequestScopeRef.current = requestScopeKey;
    activeRequestTargetRef.current = requestTargetKey;
    requestSequenceRef.current += 1;
    inFlightTargetRef.current = null;
    setLoading(false);
    setError(null);
    if (scopeChanged) {
      dataByTargetRef.current = {};
      setDataByTarget({});
    }
  }, [requestScopeKey, requestTargetKey]);

  const load = useCallback(
    async (force = false) => {
      if (!bucketName || !enabled) return;
      if (!force && dataByTargetRef.current[requestTargetKey]) {
        setError(null);
        return;
      }
      if (!force && inFlightTargetRef.current === requestTargetKey) return;

      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;
      inFlightTargetRef.current = requestTargetKey;
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchBucketInspectorData({
          accountId,
          bucketName,
          includeUsage,
          includeStaticWebsite,
        });
        if (requestSequenceRef.current !== requestSequence) return;
        const next = {
          ...dataByTargetRef.current,
          [requestTargetKey]: payload,
        };
        dataByTargetRef.current = next;
        setDataByTarget(next);
      } catch (loadError) {
        if (requestSequenceRef.current !== requestSequence) return;
        setError(
          extractApiError(
            loadError,
            "Unable to load bucket stats and features.",
          ),
        );
      } finally {
        if (requestSequenceRef.current === requestSequence) {
          inFlightTargetRef.current = null;
          setLoading(false);
        }
      }
    },
    [
      accountId,
      bucketName,
      enabled,
      includeStaticWebsite,
      includeUsage,
      requestTargetKey,
    ],
  );

  const data = dataByTarget[requestTargetKey] ?? null;
  const features = useMemo(() => buildBucketInspectorFeatures(data), [data]);

  return {
    data,
    error,
    features,
    load,
    loading,
  };
}

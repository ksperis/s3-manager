/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import { getBucketStats } from "../../../api/bucketDetails";
import type { Bucket } from "../../../api/bucketContracts";
import { listCephAdminBuckets } from "../../../api/cephAdminBuckets";
import { extractApiError } from "../../../utils/apiError";

type UseBucketMetadataControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
  withStats: boolean;
};

export function useBucketMetadataController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
  withStats,
}: UseBucketMetadataControllerOptions) {
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    setBucket(null);
    setError(null);
    setLoading(false);
  }, [accountId, bucketName, cephAdmin, enabled, endpointId, withStats]);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!bucketName || !enabled || (cephAdmin && !endpointId)) {
      setBucket(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let nextBucket: Bucket | null;
      if (cephAdmin) {
        if (!endpointId) return;
        const response = await listCephAdminBuckets(endpointId, {
          page: 1,
          page_size: 50,
          filter: bucketName,
          with_stats: withStats,
        });
        const found =
          response.items.find((candidate) => candidate.name === bucketName) ??
          null;
        nextBucket = found
          ? {
              ...found,
              used_bytes: found.used_bytes ?? undefined,
              object_count: found.object_count ?? undefined,
            }
          : null;
      } else {
        nextBucket = await getBucketStats(accountId, bucketName, {
          with_stats: withStats,
        });
      }
      if (requestId !== requestIdRef.current) return;
      setBucket(nextBucket);
    } catch (loadFailure) {
      if (requestId !== requestIdRef.current) return;
      setError(
        extractApiError(loadFailure, "Unable to load bucket details."),
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [accountId, bucketName, cephAdmin, enabled, endpointId, withStats]);

  return {
    bucket,
    error,
    loading,
    refresh,
  };
}

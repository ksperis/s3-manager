/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  getCephAdminBucketUsageStats,
  getManagerBucketUsageStats,
  streamCephAdminBucketUsageStatsForBucket,
  streamManagerBucketUsageStatsForBucket,
  type BucketUsageStatsSnapshot,
} from "../../../api/bucketUsageStats";
import { extractApiError } from "../../../utils/apiError";

type UseBucketUsageStatsControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

export function useBucketUsageStatsController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketUsageStatsControllerOptions) {
  const [snapshot, setSnapshot] = useState<BucketUsageStatsSnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      setSnapshot(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let data;
      if (cephAdmin) {
        if (!endpointId) {
          setSnapshot(null);
          return;
        }
        data = await getCephAdminBucketUsageStats(endpointId, bucketName);
      } else {
        data = await getManagerBucketUsageStats(accountId, bucketName);
      }
      setSnapshot(data.snapshot ?? null);
    } catch (loadFailure) {
      setSnapshot(null);
      setError(extractApiError(loadFailure, "Unable to load bucket usage stats."));
    } finally {
      setLoading(false);
    }
  }, [accountId, bucketName, cephAdmin, enabled, endpointId]);

  const recalculate = useCallback(async () => {
    if (!bucketName || !enabled || recalculating) return;
    setRecalculating(true);
    setError(null);
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await streamCephAdminBucketUsageStatsForBucket(endpointId, bucketName);
      } else {
        await streamManagerBucketUsageStatsForBucket(accountId, bucketName);
      }
      await load();
    } catch (recalculationFailure) {
      setError(
        extractApiError(
          recalculationFailure,
          "Unable to calculate bucket usage stats.",
        ),
      );
    } finally {
      setRecalculating(false);
    }
  }, [accountId, bucketName, cephAdmin, enabled, endpointId, load, recalculating]);

  return {
    error,
    load,
    loading,
    recalculate,
    recalculating,
    snapshot,
  };
}

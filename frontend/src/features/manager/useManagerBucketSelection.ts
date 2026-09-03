/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import { listBuckets } from "../../api/managerBuckets";
import type { Bucket } from "../../api/bucketContracts";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { useS3AccountContext } from "./S3AccountContext";

export function useManagerBucketSelection() {
  const { accounts, selectedS3AccountId, requiresS3AccountSelection } = useS3AccountContext();
  const sourceContextId = selectedS3AccountId ?? "";
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());

  const sourceContext = useMemo(
    () => accounts.find((context) => context.id === sourceContextId) ?? null,
    [accounts, sourceContextId]
  );

  useEffect(() => {
    if (!sourceContextId) {
      setBuckets([]);
      setSelectedBuckets(new Set());
      return;
    }
    let canceled = false;
    setLoading(true);
    setError(null);
    listBuckets(sourceContextId, { with_stats: false })
      .then((items) => {
        if (canceled) return;
        const sorted = [...items].sort((left, right) => left.name.localeCompare(right.name));
        setBuckets(sorted);
        setSelectedBuckets((current) => {
          const availableNames = new Set(sorted.map((bucket) => bucket.name));
          return new Set([...current].filter((bucketName) => availableNames.has(bucketName)));
        });
      })
      .catch((requestError) => {
        if (canceled) return;
        setError(extractApiError(requestError, "Unable to load buckets."));
        setBuckets([]);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [sourceContextId]);

  const filteredBuckets = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return buckets;
    return buckets.filter((bucket) => bucket.name.toLowerCase().includes(needle));
  }, [buckets, filter]);

  const selectedBucketList = useMemo(
    () => [...selectedBuckets].sort((left, right) => left.localeCompare(right)),
    [selectedBuckets]
  );

  const selectedTargets = useMemo(
    () =>
      selectedBucketList.map((bucketName) => ({
        bucketName,
        contextId: sourceContextId,
        contextName: sourceContext?.display_name ?? sourceContextId,
      })),
    [selectedBucketList, sourceContext?.display_name, sourceContextId]
  );

  const toggleBucket = (bucketName: string) => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      if (next.has(bucketName)) {
        next.delete(bucketName);
      } else {
        next.add(bucketName);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      filteredBuckets.forEach((bucket) => next.add(bucket.name));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedBuckets(new Set());
  };

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredBuckets.length,
  });

  return {
    clearSelection,
    error,
    filter,
    filteredBuckets,
    loading,
    requiresS3AccountSelection,
    selectedBucketList,
    selectedBuckets,
    selectedTargets,
    selectAllFiltered,
    setFilter,
    sourceContext,
    sourceContextId,
    tableStatus,
    toggleBucket,
  };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { listBuckets, type Bucket } from "../../../api/buckets";
import { listExecutionContexts, type ExecutionContext } from "../../../api/executionContexts";
import {
  getManagerMigration,
  listManagerMigrations,
  streamManagerMigration,
  type BucketMigrationDetail,
  type BucketMigrationView,
} from "../../../api/managerMigrations";
import { extractError, isFinalMigrationStatus, normalizeEndpointUrl } from "./shared";

export function useManagerContexts() {
  const [contexts, setContexts] = useState<ExecutionContext[]>([]);
  const [contextsLoading, setContextsLoading] = useState(true);
  const [contextsError, setContextsError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setContextsLoading(true);
    setContextsError(null);
    listExecutionContexts("manager")
      .then((items) => {
        if (canceled) return;
        setContexts(items);
      })
      .catch((error) => {
        if (canceled) return;
        setContextsError(extractError(error));
      })
      .finally(() => {
        if (!canceled) setContextsLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, []);

  const contextLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const context of contexts) {
      map.set(context.id, context.display_name);
    }
    return map;
  }, [contexts]);

  return {
    contexts,
    contextLabelById,
    contextsLoading,
    contextsError,
  };
}

export function useManagerSourceBuckets(sourceContextId: string) {
  const [sourceBuckets, setSourceBuckets] = useState<Bucket[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [bucketsError, setBucketsError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceContextId) {
      setSourceBuckets([]);
      setBucketsError(null);
      setBucketsLoading(false);
      return;
    }
    let canceled = false;
    setBucketsLoading(true);
    setBucketsError(null);
    listBuckets(sourceContextId, { with_stats: false })
      .then((items) => {
        if (canceled) return;
        setSourceBuckets([...items].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((error) => {
        if (canceled) return;
        setBucketsError(extractError(error));
        setSourceBuckets([]);
      })
      .finally(() => {
        if (!canceled) setBucketsLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [sourceContextId]);

  return {
    sourceBuckets,
    bucketsLoading,
    bucketsError,
  };
}

export function useManagerMigrationsList(sourceContextId: string) {
  const [migrations, setMigrations] = useState<BucketMigrationView[]>([]);
  const [migrationsLoading, setMigrationsLoading] = useState(true);
  const [migrationsError, setMigrationsError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setMigrationsError(null);
    if (!sourceContextId) {
      setMigrations([]);
      return;
    }
    try {
      const items = await listManagerMigrations(100, sourceContextId);
      setMigrations(items);
    } catch (error) {
      setMigrationsError(extractError(error));
    }
  }, [sourceContextId]);

  useEffect(() => {
    setMigrationsLoading(true);
    refresh().finally(() => setMigrationsLoading(false));
    const interval = window.setInterval(() => {
      refresh().catch(() => {});
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return {
    migrations,
    migrationsLoading,
    migrationsError,
    refresh,
    setMigrations,
  };
}

export function useManagerMigrationDetail(migrationId: number | null) {
  const [migrationDetail, setMigrationDetail] = useState<BucketMigrationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailStreamAbortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!migrationId) {
      setMigrationDetail(null);
      return;
    }
    setDetailError(null);
    const detail = await getManagerMigration(migrationId);
    setMigrationDetail(detail);
  }, [migrationId]);

  useEffect(() => {
    if (!migrationId) {
      detailStreamAbortRef.current?.abort();
      detailStreamAbortRef.current = null;
      setMigrationDetail(null);
      setDetailLoading(false);
      return;
    }

    let canceled = false;
    let fallbackInterval: number | null = null;

    const stopFallbackPolling = () => {
      if (fallbackInterval == null) return;
      window.clearInterval(fallbackInterval);
      fallbackInterval = null;
    };

    const applyDetail = (detail: BucketMigrationDetail) => {
      if (canceled) return;
      setMigrationDetail(detail);
      if (isFinalMigrationStatus(detail.status)) {
        stopFallbackPolling();
      }
    };

    const runFallbackPolling = () => {
      if (fallbackInterval != null) return;
      void getManagerMigration(migrationId)
        .then((detail) => {
          if (!canceled) applyDetail(detail);
        })
        .catch(() => {});
      fallbackInterval = window.setInterval(() => {
        getManagerMigration(migrationId)
          .then((detail) => {
            if (!canceled) applyDetail(detail);
          })
          .catch(() => {});
      }, 3000);
    };

    detailStreamAbortRef.current?.abort();
    const streamAbortController = new AbortController();
    detailStreamAbortRef.current = streamAbortController;

    setDetailLoading(true);
    setDetailError(null);
    getManagerMigration(migrationId)
      .then((detail) => {
        applyDetail(detail);
      })
      .catch((error) => {
        if (canceled) return;
        setDetailError(extractError(error));
      })
      .finally(() => {
        if (!canceled) setDetailLoading(false);
      });

    void streamManagerMigration(migrationId, {
      signal: streamAbortController.signal,
      onSnapshot: (detail) => {
        if (canceled) return;
        setDetailLoading(false);
        applyDetail(detail);
      },
    }).catch(() => {
      if (canceled || streamAbortController.signal.aborted) return;
      runFallbackPolling();
    });

    return () => {
      canceled = true;
      streamAbortController.abort();
      if (detailStreamAbortRef.current === streamAbortController) {
        detailStreamAbortRef.current = null;
      }
      stopFallbackPolling();
    };
  }, [migrationId]);

  return {
    migrationDetail,
    setMigrationDetail,
    detailLoading,
    detailError,
    setDetailError,
    refresh,
  };
}

export function useCrossEndpointSelection(source: ExecutionContext | null, target: ExecutionContext | null): boolean {
  return useMemo(() => {
    if (!source || !target) return false;
    if (source.endpoint_id != null && target.endpoint_id != null) {
      return source.endpoint_id !== target.endpoint_id;
    }
    const sourceEndpointUrl = normalizeEndpointUrl(source.endpoint_url);
    const targetEndpointUrl = normalizeEndpointUrl(target.endpoint_url);
    if (sourceEndpointUrl && targetEndpointUrl) {
      return sourceEndpointUrl !== targetEndpointUrl;
    }
    return false;
  }, [source, target]);
}

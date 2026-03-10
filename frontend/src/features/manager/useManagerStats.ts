/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { S3AccountSelector } from "../../api/accountParams";
import { fetchManagerStats, ManagerStats } from "../../api/stats";
import { extractManagerError } from "./errorUtils";

type UseManagerStatsResult = {
  stats: ManagerStats | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useManagerStats(
  accountId: S3AccountSelector,
  enabled: boolean = true,
  refreshKey?: string | null
): UseManagerStatsResult {
  const [stats, setStats] = useState<ManagerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setStats(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setStats(null);
    try {
      const data = await fetchManagerStats(accountId);
      setStats(data);
      setError(null);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setError("Storage metrics are not available for this credential.");
      } else {
        setError(extractManagerError(err, "Unable to load manager stats."));
      }
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [accountId, enabled, refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { stats, loading, error, reload: load };
}

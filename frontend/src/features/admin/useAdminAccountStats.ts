/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { fetchAdminAccountStats, ManagerStats } from "../../api/stats";

type UseAdminAccountStatsResult = {
  stats: ManagerStats | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useAdminAccountStats(
  accountId: number | null,
  enabled: boolean = true,
  refreshKey?: string | null
): UseAdminAccountStatsResult {
  const [stats, setStats] = useState<ManagerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || accountId == null) {
      setStats(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setStats(null);
    try {
      const data = await fetchAdminAccountStats(accountId);
      setStats(data);
      setError(null);
    } catch (err) {
      let message = "Unable to load usage stats.";
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          message = detail;
        } else if (err.response?.status === 403) {
          message = "Usage metrics are not available for this account.";
        }
      }
      setError(message);
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

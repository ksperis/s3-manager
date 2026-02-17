/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { fetchAdminS3UserStats, ManagerStats } from "../../api/stats";

type UseAdminS3UserStatsResult = {
  stats: ManagerStats | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useAdminS3UserStats(
  userId: number | null,
  enabled: boolean = true,
  refreshKey?: string | null
): UseAdminS3UserStatsResult {
  const [stats, setStats] = useState<ManagerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || userId == null) {
      setStats(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setStats(null);
    try {
      const data = await fetchAdminS3UserStats(userId);
      setStats(data);
      setError(null);
    } catch (err) {
      let message = "Unable to load storage stats.";
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          message = detail;
        } else if (err.response?.status === 403) {
          message = "Storage metrics are not available for this user.";
        }
      }
      setError(message);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [userId, enabled, refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { stats, loading, error, reload: load };
}

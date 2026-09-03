/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";

import {
  fetchAdminPendingRequestCounts,
  type AdminPendingRequestCounts,
} from "../api/adminNavigation";
import { ADMIN_PENDING_REQUESTS_REFRESH_EVENT } from "../utils/adminPendingRequestsRefresh";

export const ADMIN_PENDING_REQUESTS_REFRESH_INTERVAL_MS = 60_000;

export function useAdminPendingRequestCounts(): AdminPendingRequestCounts | null {
  const [counts, setCounts] = useState<AdminPendingRequestCounts | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const requestRefresh = () => setRefreshToken((value) => value + 1);
    window.addEventListener(ADMIN_PENDING_REQUESTS_REFRESH_EVENT, requestRefresh);
    return () => window.removeEventListener(ADMIN_PENDING_REQUESTS_REFRESH_EVENT, requestRefresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const nextCounts = await fetchAdminPendingRequestCounts(controller.signal);
        if (!controller.signal.aborted) setCounts(nextCounts);
      } catch {
        // Navigation remains usable and retains the last successfully loaded counts.
      }
    };

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, ADMIN_PENDING_REQUESTS_REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshToken]);

  return counts;
}

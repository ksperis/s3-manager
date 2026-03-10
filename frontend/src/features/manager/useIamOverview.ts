/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { fetchIamOverview, IamOverview } from "../../api/iamOverview";
import { S3AccountSelector } from "../../api/accountParams";
import { extractApiError } from "../../utils/apiError";

type UseIamOverviewResult = {
  overview: IamOverview | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useIamOverview(
  accountId: S3AccountSelector,
  enabled: boolean,
  hasContext: boolean = true,
  refreshKey?: string | null
): UseIamOverviewResult {
  const [overview, setOverview] = useState<IamOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !hasContext) {
      setOverview(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchIamOverview(accountId || undefined);
      setOverview(data);
      setError(data.warnings && data.warnings.length > 0 ? data.warnings.join("; ") : null);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setError("IAM inventory unavailable for this credential.");
      } else {
        setError(extractApiError(err, "Unable to load IAM overview."));
      }
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, [accountId, enabled, hasContext, refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return { overview, loading, error, reload: load };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import type { ManagerTrafficStats } from "../../api/stats";
import { fetchPortalWorkspaceHealthOverview, type WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import {
  fetchPortalState,
  listPortalStorageSpaces,
  fetchPortalTraffic,
  fetchPortalUsage,
  type PortalStorageSpaceSummary,
  type PortalState,
  type PortalUsage,
} from "../../api/portal";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { buildPortalWorkspaceModel, type PortalWorkspaceAlert } from "./portalWorkspaceMockData";
import { usePortalAccountContext } from "./PortalAccountContext";

function readUserEmail(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { email?: string | null };
    return parsed.email ?? null;
  } catch {
    return null;
  }
}

export function usePortalWorkspaceData({
  includeTraffic = false,
  includeHealth = false,
}: { includeTraffic?: boolean; includeHealth?: boolean } = {}) {
  const { t } = useI18n();
  const accountContext = usePortalAccountContext();
  const { accountIdForApi, selectedAccount, hasAccountContext, loading: accountLoading, error: accountError } = accountContext;
  const [state, setState] = useState<PortalState | null>(null);
  const [storageSpaces, setStorageSpaces] = useState<PortalStorageSpaceSummary[] | null>(null);
  const [usage, setUsage] = useState<PortalUsage | null>(null);
  const [traffic, setTraffic] = useState<ManagerTrafficStats | null>(null);
  const [health, setHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [storageSpacesLoading, setStorageSpacesLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [storageSpacesError, setStorageSpacesError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasAccountContext || !accountIdForApi) {
      setState(null);
      setStateLoading(false);
      setStateError(null);
      return () => {
        cancelled = true;
      };
    }
    setStateLoading(true);
    setStateError(null);
    fetchPortalState(accountIdForApi)
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setState(null);
          setStateError(
            extractApiError(
              err,
              t({
                en: "Unable to load portal workspace.",
                fr: "Impossible de charger le workspace portail.",
                de: "Portal-Workspace kann nicht geladen werden.",
              })
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setStateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, t]);

  useEffect(() => {
    let cancelled = false;
    if (!hasAccountContext || !accountIdForApi) {
      setStorageSpaces(null);
      setStorageSpacesLoading(false);
      setStorageSpacesError(null);
      return () => {
        cancelled = true;
      };
    }
    setStorageSpacesLoading(true);
    setStorageSpacesError(null);
    listPortalStorageSpaces(accountIdForApi)
      .then((data) => {
        if (!cancelled) setStorageSpaces(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setStorageSpaces(null);
          setStorageSpacesError(
            extractApiError(
              err,
              t({
                en: "Unable to load storage spaces.",
                fr: "Impossible de charger les espaces de stockage.",
                de: "Storage Spaces konnen nicht geladen werden.",
              })
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setStorageSpacesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, t]);

  useEffect(() => {
    let cancelled = false;
    if (!hasAccountContext || !accountIdForApi) {
      setUsage(null);
      setUsageLoading(false);
      setUsageError(null);
      return () => {
        cancelled = true;
      };
    }
    setUsageLoading(true);
    setUsageError(null);
    fetchPortalUsage(accountIdForApi)
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setUsage(null);
          setUsageError(
            extractApiError(
              err,
              t({
                en: "Usage data is unavailable.",
                fr: "Les donnees d'usage sont indisponibles.",
                de: "Nutzungsdaten sind nicht verfugbar.",
              })
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, t]);

  useEffect(() => {
    let cancelled = false;
    if (!includeTraffic || !hasAccountContext || !accountIdForApi) {
      setTraffic(null);
      setTrafficLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setTrafficLoading(true);
    fetchPortalTraffic(accountIdForApi, "week")
      .then((data) => {
        if (!cancelled) setTraffic(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setTraffic(null);
      })
      .finally(() => {
        if (!cancelled) setTrafficLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, includeTraffic]);

  useEffect(() => {
    let cancelled = false;
    if (!includeHealth || !hasAccountContext || !accountIdForApi) {
      setHealth(null);
      setHealthLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setHealthLoading(true);
    fetchPortalWorkspaceHealthOverview(accountIdForApi)
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setHealth(null);
      })
      .finally(() => {
        if (!cancelled) setHealthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, includeHealth]);

  const workspace = useMemo(
    () =>
      buildPortalWorkspaceModel({
        account: selectedAccount,
        state,
        storageSpaces,
        usage,
        userEmail: readUserEmail(),
      }),
    [selectedAccount, state, storageSpaces, usage]
  );
  const healthAlerts = useMemo<PortalWorkspaceAlert[]>(() => {
    if (!health) return [];
    const ongoingIncident = health.incidents.find(
      (incident) => incident.ongoing && (incident.status === "down" || incident.status === "degraded")
    );
    if (ongoingIncident) {
      return [
        {
          id: `health-${ongoingIncident.endpoint_id}`,
          tone: ongoingIncident.status === "down" ? "danger" : "warning",
          title: "Storage service availability issue",
          description:
            ongoingIncident.status === "down"
              ? "One storage service is currently unavailable. Transfers may fail until it recovers."
              : "One storage service is degraded. Transfers may be slower than usual.",
        },
      ];
    }
    if (health.down_count > 0 || health.degraded_count > 0) {
      return [
        {
          id: "health-degraded",
          tone: health.down_count > 0 ? "danger" : "warning",
          title: "Storage service needs attention",
          description: "One storage service reported recent availability issues.",
        },
      ];
    }
    return [];
  }, [health]);

  return {
    ...accountContext,
    state,
    storageSpaces,
    usage,
    traffic,
    health,
    healthAlerts,
    workspace,
    loading: accountLoading || stateLoading || storageSpacesLoading,
    stateLoading,
    storageSpacesLoading,
    usageLoading,
    trafficLoading,
    healthLoading,
    error: accountError ?? stateError ?? storageSpacesError,
    stateError,
    storageSpacesError,
    usageError,
  };
}

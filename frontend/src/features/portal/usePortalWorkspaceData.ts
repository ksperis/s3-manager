/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import type { ManagerTrafficStats, ManagerUsageTrendsResponse, TrafficWindow } from "../../api/stats";
import { fetchPortalWorkspaceHealthOverview, type WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import {
  fetchPortalActivity,
  fetchPortalAlerts,
  fetchPortalState,
  fetchPortalTransfers,
  listPortalStorageSpaces,
  fetchPortalTraffic,
  fetchPortalUsage,
  fetchPortalUsageTrends,
  type PortalActivityItem,
  type PortalAlert,
  type PortalStorageSpaceSummary,
  type PortalState,
  type PortalTransfer,
  type PortalUsage,
} from "../../api/portal";
import { WORKSPACE_TRAFFIC_TREND_WINDOWS } from "../../components/workspaceDashboardKpis";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { CLIENT_STORAGE_KEYS, readClientJson } from "../../utils/clientStorage";
import {
  buildPortalWorkspaceModel,
  type PortalWorkspaceActivityItem,
  type PortalWorkspaceAlert,
  type PortalWorkspaceTransfer,
} from "./portalWorkspaceModel";
import { usePortalAccountContext } from "./PortalAccountContext";
import { listPortalLocalTransfers, subscribePortalTransferUpdates } from "./portalTransferTracker";

function readUserEmail(): string | null {
  if (typeof window === "undefined") return null;
  return readClientJson<{ email?: string | null }>(CLIENT_STORAGE_KEYS.sessionUser)?.email ?? null;
}

function shortTimeLabel(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const diffMs = Date.now() - parsed.getTime();
  if (diffMs < 60_000) return "Now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function activityFromApi(item: PortalActivityItem): PortalWorkspaceActivityItem {
  return {
    id: `api-activity-${item.id}`,
    actor: item.actor,
    action: item.action,
    target: item.target,
    spaceId: item.storage_space_id ?? undefined,
    spaceName: item.storage_space_name ?? undefined,
    timeLabel: shortTimeLabel(item.created_at),
    ipAddress: item.ip_address ?? "-",
  };
}

function transferFromApi(item: PortalTransfer): PortalWorkspaceTransfer {
  return {
    id: item.id,
    name: item.name,
    direction: item.direction,
    status: item.status,
    progress: item.progress,
    sizeBytes: item.size_bytes,
    spaceName: item.storage_space_name ?? "Workspace",
    startedLabel: shortTimeLabel(item.started_at),
    etaLabel: item.eta_label,
    speedLabel: item.speed_label,
    errorMessage: item.error_message ?? null,
  };
}

function alertFromApi(item: PortalAlert): PortalWorkspaceAlert {
  return {
    id: item.id,
    tone: item.tone,
    title: item.title,
    description: item.description,
    severityLabel: item.severity_label,
  };
}

export function usePortalWorkspaceData({
  includeTraffic = false,
  includeTrafficTrend = false,
  includeHealth = false,
  includeUsageTrends = false,
  trafficWindow = "week",
}: {
  includeTraffic?: boolean;
  includeTrafficTrend?: boolean;
  includeHealth?: boolean;
  includeUsageTrends?: boolean;
  trafficWindow?: TrafficWindow;
} = {}) {
  const { t } = useI18n();
  const accountContext = usePortalAccountContext();
  const { accountIdForApi, selectedAccount, hasAccountContext, loading: accountLoading, error: accountError } = accountContext;
  const [state, setState] = useState<PortalState | null>(null);
  const [storageSpaces, setStorageSpaces] = useState<PortalStorageSpaceSummary[] | null>(null);
  const [usage, setUsage] = useState<PortalUsage | null>(null);
  const [traffic, setTraffic] = useState<ManagerTrafficStats | null>(null);
  const [trafficByWindow, setTrafficByWindow] = useState<Partial<Record<TrafficWindow, ManagerTrafficStats>>>({});
  const [usageTrends, setUsageTrends] = useState<ManagerUsageTrendsResponse | null>(null);
  const [health, setHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [activity, setActivity] = useState<PortalActivityItem[] | null>(null);
  const [transfers, setTransfers] = useState<PortalTransfer[] | null>(null);
  const [alerts, setAlerts] = useState<PortalAlert[] | null>(null);
  const [localTransfers, setLocalTransfers] = useState<PortalWorkspaceTransfer[]>([]);
  const [stateLoading, setStateLoading] = useState(false);
  const [storageSpacesLoading, setStorageSpacesLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [usageTrendsLoading, setUsageTrendsLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [storageSpacesError, setStorageSpacesError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageTrendsError, setUsageTrendsError] = useState<string | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);

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
    if (!includeUsageTrends || !hasAccountContext || !accountIdForApi) {
      setUsageTrends(null);
      setUsageTrendsLoading(false);
      setUsageTrendsError(null);
      return () => {
        cancelled = true;
      };
    }
    setUsageTrendsLoading(true);
    setUsageTrendsError(null);
    fetchPortalUsageTrends(accountIdForApi)
      .then((data) => {
        if (!cancelled) setUsageTrends(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setUsageTrends(null);
          setUsageTrendsError(
            extractApiError(
              err,
              t({
                en: "Usage trend data is unavailable.",
                fr: "Les tendances d'usage sont indisponibles.",
                de: "Nutzungstrends sind nicht verfugbar.",
              })
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setUsageTrendsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, includeUsageTrends, t]);

  useEffect(() => {
    let cancelled = false;
    if (!includeTraffic || !hasAccountContext || !accountIdForApi) {
      setTraffic(null);
      setTrafficByWindow({});
      setTrafficLoading(false);
      setTrafficError(null);
      return () => {
        cancelled = true;
      };
    }
    setTrafficLoading(true);
    setTrafficError(null);
    const windows = includeTrafficTrend
      ? WORKSPACE_TRAFFIC_TREND_WINDOWS.map((option) => option.window)
      : [trafficWindow];
    Promise.allSettled(
      windows.map((window) => fetchPortalTraffic(accountIdForApi, window).then((data) => [window, data] as const))
    )
      .then((results) => {
        if (cancelled) return;
        const entries = results
          .filter((result): result is PromiseFulfilledResult<readonly [TrafficWindow, ManagerTrafficStats]> => result.status === "fulfilled")
          .map((result) => result.value);
        const statsByWindow = Object.fromEntries(entries) as Partial<Record<TrafficWindow, ManagerTrafficStats>>;
        const selectedWindow = includeTrafficTrend ? "day" : trafficWindow;
        const selectedTraffic = statsByWindow[selectedWindow] ?? null;
        const selectedFailure = results[windows.indexOf(selectedWindow)];
        setTrafficByWindow(statsByWindow);
        setTraffic(selectedTraffic);
        setTrafficError(
          selectedTraffic
            ? null
            : extractApiError(
                selectedFailure?.status === "rejected" ? selectedFailure.reason : undefined,
                t({
                  en: "Traffic data is unavailable.",
                  fr: "Les donnees de trafic sont indisponibles.",
                  de: "Traffic-Daten sind nicht verfugbar.",
                })
              )
        );
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setTraffic(null);
          setTrafficByWindow({});
          setTrafficError(
            extractApiError(
              err,
              t({
                en: "Traffic data is unavailable.",
                fr: "Les donnees de trafic sont indisponibles.",
                de: "Traffic-Daten sind nicht verfugbar.",
              })
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setTrafficLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, includeTraffic, includeTrafficTrend, t, trafficWindow]);

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

  useEffect(() => {
    let cancelled = false;
    if (!hasAccountContext || !accountIdForApi) {
      setActivity(null);
      setActivityLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setActivityLoading(true);
    fetchPortalActivity(accountIdForApi, { limit: 100 })
      .then((data) => {
        if (!cancelled) setActivity(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setActivity(null);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext]);

  useEffect(() => {
    let cancelled = false;
    if (!hasAccountContext || !accountIdForApi) {
      setTransfers(null);
      setTransfersLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setTransfersLoading(true);
    fetchPortalTransfers(accountIdForApi, { limit: 100 })
      .then((data) => {
        if (!cancelled) setTransfers(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setTransfers(null);
      })
      .finally(() => {
        if (!cancelled) setTransfersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext]);

  useEffect(() => {
    let cancelled = false;
    if (!hasAccountContext || !accountIdForApi) {
      setAlerts(null);
      setAlertsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setAlertsLoading(true);
    fetchPortalAlerts(accountIdForApi)
      .then((data) => {
        if (!cancelled) setAlerts(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setAlerts(null);
      })
      .finally(() => {
        if (!cancelled) setAlertsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext]);

  useEffect(() => {
    if (!accountIdForApi) {
      setLocalTransfers([]);
      return () => undefined;
    }
    const refresh = () => setLocalTransfers(listPortalLocalTransfers(accountIdForApi));
    refresh();
    return subscribePortalTransferUpdates(refresh);
  }, [accountIdForApi]);

  const workspace = useMemo(() => {
    const base = buildPortalWorkspaceModel({
        account: selectedAccount,
        state,
        storageSpaces,
        usage,
        userEmail: readUserEmail(),
      });
    return {
      ...base,
      activity: activity ? activity.map(activityFromApi) : [],
      transfers: [...localTransfers, ...(transfers ?? []).map(transferFromApi)],
      alerts: alerts ? alerts.map(alertFromApi) : [],
      usageTrend: (traffic?.series ?? []).map((point) => ({
        label: new Date(point.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        value: point.bytes_in + point.bytes_out,
      })),
      requestCount: traffic?.totals.ops ?? null,
      dataInBytes: traffic?.totals.bytes_in ?? null,
      dataOutBytes: traffic?.totals.bytes_out ?? null,
    };
  }, [activity, alerts, localTransfers, selectedAccount, state, storageSpaces, traffic, transfers, usage]);
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
    trafficByWindow,
    usageTrends,
    health,
    healthAlerts,
    workspace,
    loading: accountLoading || stateLoading || storageSpacesLoading,
    stateLoading,
    storageSpacesLoading,
    usageLoading,
    trafficLoading,
    usageTrendsLoading,
    healthLoading,
    activityLoading,
    transfersLoading,
    alertsLoading,
    error: accountError ?? stateError ?? storageSpacesError,
    stateError,
    storageSpacesError,
    usageError,
    usageTrendsError,
    trafficError,
  };
}

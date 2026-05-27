/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import type { ManagerTrafficStats } from "../../api/stats";
import { fetchPortalWorkspaceHealthOverview, type WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import {
  fetchPortalActivity,
  fetchPortalAlerts,
  fetchPortalState,
  fetchPortalTransfers,
  listPortalStorageSpaces,
  fetchPortalTraffic,
  fetchPortalUsage,
  type PortalActivityItem,
  type PortalAlert,
  type PortalStorageSpaceSummary,
  type PortalState,
  type PortalTransfer,
  type PortalUsage,
} from "../../api/portal";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import {
  buildPortalWorkspaceModel,
  type PortalWorkspaceActivityItem,
  type PortalWorkspaceAlert,
  type PortalWorkspaceTransfer,
} from "./portalWorkspaceMockData";
import { usePortalAccountContext } from "./PortalAccountContext";
import { listPortalLocalTransfers, subscribePortalTransferUpdates } from "./portalTransferTracker";

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
  const [activity, setActivity] = useState<PortalActivityItem[] | null>(null);
  const [transfers, setTransfers] = useState<PortalTransfer[] | null>(null);
  const [alerts, setAlerts] = useState<PortalAlert[] | null>(null);
  const [localTransfers, setLocalTransfers] = useState<PortalWorkspaceTransfer[]>([]);
  const [stateLoading, setStateLoading] = useState(false);
  const [storageSpacesLoading, setStorageSpacesLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
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
      activity: activity ? activity.map(activityFromApi) : base.activity,
      transfers:
        transfers || localTransfers.length > 0
          ? [...localTransfers, ...(transfers ?? []).map(transferFromApi)]
          : base.transfers,
      alerts: alerts ? alerts.map(alertFromApi) : base.alerts,
    };
  }, [activity, alerts, localTransfers, selectedAccount, state, storageSpaces, transfers, usage]);
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
    activityLoading,
    transfersLoading,
    alertsLoading,
    error: accountError ?? stateError ?? storageSpacesError,
    stateError,
    storageSpacesError,
    usageError,
  };
}

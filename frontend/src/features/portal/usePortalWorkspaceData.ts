/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ManagerTrafficStats, ManagerUsageTrendsResponse, TrafficWindow } from "../../api/stats";
import { fetchPortalWorkspaceHealthOverview, type WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import {
  fetchPortalActivity,
  fetchPortalAlerts,
  fetchPortalCollaborators,
  fetchPortalState,
  listPortalStorageSpaces,
  fetchPortalTraffic,
  fetchPortalUsage,
  fetchPortalUsageTrends,
  type PortalActivityItem,
  type PortalAlert,
  type PortalCollaboratorsResponse,
  type PortalStorageSpaceSummary,
  type PortalState,
  type PortalUsage,
} from "../../api/portal";
import { WORKSPACE_TRAFFIC_TREND_WINDOWS } from "../../components/workspaceDashboardKpis";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { readStoredUser } from "../../utils/workspaces";
import {
  buildPortalWorkspaceModel,
  type PortalWorkspaceActivityItem,
  type PortalWorkspaceAlert,
} from "./portalWorkspaceModel";
import {
  portalActivityActionLabel,
  portalDateLabel,
  portalSeverityLabel,
  portalTimeAgoLabel,
} from "./portalI18n";
import { usePortalAccountContext } from "./PortalAccountContext";

function readUserEmail(): string | null {
  if (typeof window === "undefined") return null;
  return readStoredUser()?.email ?? null;
}

function activityFromApi(item: PortalActivityItem, locale: ReturnType<typeof useI18n>["locale"], t: ReturnType<typeof useI18n>["t"]): PortalWorkspaceActivityItem {
  return {
    id: `api-activity-${item.id}`,
    actor: item.actor,
    action: portalActivityActionLabel(item.action, t),
    target: item.target,
    spaceId: item.storage_space_id ?? undefined,
    spaceName: item.storage_space_name ?? undefined,
    timeLabel: portalTimeAgoLabel(item.created_at, locale, t),
    ipAddress: item.ip_address ?? "-",
  };
}

function alertFromApi(item: PortalAlert, t: ReturnType<typeof useI18n>["t"]): PortalWorkspaceAlert {
  return {
    id: item.id,
    tone: item.tone,
    title: item.title,
    description: item.description,
    severityLabel: portalSeverityLabel(item.severity_label, t),
  };
}

export function usePortalWorkspaceData({
  includeArchived = false,
  includeUsage = false,
  includeActivity = false,
  includeCollaborators = false,
  includeAlerts = false,
  includeTraffic = false,
  includeTrafficTrend = false,
  includeHealth = false,
  includeUsageTrends = false,
  trafficWindow = "week",
}: {
  includeArchived?: boolean;
  includeUsage?: boolean;
  includeActivity?: boolean;
  includeCollaborators?: boolean;
  includeAlerts?: boolean;
  includeTraffic?: boolean;
  includeTrafficTrend?: boolean;
  includeHealth?: boolean;
  includeUsageTrends?: boolean;
  trafficWindow?: TrafficWindow;
} = {}) {
  const { locale, t } = useI18n();
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
  const [collaborators, setCollaborators] = useState<PortalCollaboratorsResponse | null>(null);
  const [alerts, setAlerts] = useState<PortalAlert[] | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [storageSpacesLoading, setStorageSpacesLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [usageTrendsLoading, setUsageTrendsLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [storageSpacesError, setStorageSpacesError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageTrendsError, setUsageTrendsError] = useState<string | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [collaboratorsError, setCollaboratorsError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshWorkspaceData = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

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
        if (!cancelled) {
          setState(null);
          setStateError(
            extractApiError(
              err,
              t({
                en: "Unable to load portal workspace.",
                fr: "Impossible de charger l'espace de travail portail.",
                de: "Portal-Arbeitsbereich kann nicht geladen werden.",
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
  }, [accountIdForApi, hasAccountContext, refreshToken, t]);

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
    listPortalStorageSpaces(accountIdForApi, includeArchived ? { includeArchived: true } : undefined)
      .then((data) => {
        if (!cancelled) setStorageSpaces(data);
      })
      .catch((err) => {
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
  }, [accountIdForApi, hasAccountContext, includeArchived, refreshToken, t]);

  useEffect(() => {
    let cancelled = false;
    if (!includeUsage || !hasAccountContext || !accountIdForApi) {
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
  }, [accountIdForApi, hasAccountContext, includeUsage, refreshToken, t]);

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
  }, [accountIdForApi, hasAccountContext, includeUsageTrends, refreshToken, t]);

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
  }, [accountIdForApi, hasAccountContext, includeTraffic, includeTrafficTrend, refreshToken, t, trafficWindow]);

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
      .catch(() => {
        if (!cancelled) setHealth(null);
      })
      .finally(() => {
        if (!cancelled) setHealthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, includeHealth, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    if (!includeActivity || !hasAccountContext || !accountIdForApi) {
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
      .catch(() => {
        if (!cancelled) setActivity(null);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, includeActivity, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    if (!includeCollaborators || !hasAccountContext || !accountIdForApi) {
      setCollaborators(null);
      setCollaboratorsLoading(false);
      setCollaboratorsError(null);
      return () => {
        cancelled = true;
      };
    }
    setCollaboratorsLoading(true);
    setCollaboratorsError(null);
    fetchPortalCollaborators(accountIdForApi)
      .then((data) => {
        if (!cancelled) setCollaborators(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setCollaborators(null);
          setCollaboratorsError(
            extractApiError(
              err,
              t({
                en: "Unable to load collaborators.",
                fr: "Impossible de charger les collaborateurs.",
                de: "Mitwirkende können nicht geladen werden.",
              })
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCollaboratorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, includeCollaborators, refreshToken, t]);

  useEffect(() => {
    let cancelled = false;
    if (!includeAlerts || !hasAccountContext || !accountIdForApi) {
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
      .catch(() => {
        if (!cancelled) setAlerts(null);
      })
      .finally(() => {
        if (!cancelled) setAlertsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, includeAlerts, refreshToken]);

  const workspace = useMemo(() => {
    const base = buildPortalWorkspaceModel({
      account: selectedAccount,
      storageSpaces,
      usage,
      userEmail: readUserEmail(),
      locale,
      t,
    });
    return {
      ...base,
      activity: activity ? activity.map((item) => activityFromApi(item, locale, t)) : [],
      alerts: alerts ? alerts.map((item) => alertFromApi(item, t)) : [],
      usageTrend: (traffic?.series ?? []).map((point) => ({
        label: portalDateLabel(point.timestamp, locale, { month: "short", day: "numeric" }),
        value: point.bytes_in + point.bytes_out,
      })),
      requestCount: traffic?.totals.ops ?? null,
      dataInBytes: traffic?.totals.bytes_in ?? null,
      dataOutBytes: traffic?.totals.bytes_out ?? null,
    };
  }, [activity, alerts, locale, selectedAccount, storageSpaces, t, traffic, usage]);
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
          title: t({ en: "Storage service availability issue", fr: "Problème de disponibilité du service de stockage", de: "Verfügbarkeitsproblem des Speicherdienstes" }),
          description:
            ongoingIncident.status === "down"
              ? t({ en: "One storage service is currently unavailable. Transfers may fail until it recovers.", fr: "Un service de stockage est actuellement indisponible. Les transferts peuvent échouer jusqu'à son rétablissement.", de: "Ein Speicherdienst ist derzeit nicht verfügbar. Übertragungen können fehlschlagen, bis er wiederhergestellt ist." })
              : t({ en: "One storage service is degraded. Transfers may be slower than usual.", fr: "Un service de stockage est dégradé. Les transferts peuvent être plus lents que d'habitude.", de: "Ein Speicherdienst ist beeinträchtigt. Übertragungen können langsamer als üblich sein." }),
          severityLabel: ongoingIncident.status === "down"
            ? t({ en: "Critical", fr: "Critique", de: "Kritisch" })
            : t({ en: "Warning", fr: "Avertissement", de: "Warnung" }),
        },
      ];
    }
    if (health.down_count > 0 || health.degraded_count > 0) {
      return [
        {
          id: "health-degraded",
          tone: health.down_count > 0 ? "danger" : "warning",
          title: t({ en: "Storage service needs attention", fr: "Le service de stockage demande de l'attention", de: "Speicherdienst erfordert Aufmerksamkeit" }),
          description: t({ en: "One storage service reported recent availability issues.", fr: "Un service de stockage a signalé des problèmes de disponibilité récents.", de: "Ein Speicherdienst hat kürzlich Verfügbarkeitsprobleme gemeldet." }),
          severityLabel: health.down_count > 0
            ? t({ en: "Critical", fr: "Critique", de: "Kritisch" })
            : t({ en: "Warning", fr: "Avertissement", de: "Warnung" }),
        },
      ];
    }
    return [];
  }, [health, t]);

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
    collaborators,
    workspace,
    loading: accountLoading || storageSpacesLoading,
    accountLoading,
    stateLoading,
    storageSpacesLoading,
    usageLoading,
    trafficLoading,
    usageTrendsLoading,
    healthLoading,
    activityLoading,
    collaboratorsLoading,
    alertsLoading,
    error: accountError ?? stateError ?? storageSpacesError,
    accountError,
    stateError,
    storageSpacesError,
    usageError,
    usageTrendsError,
    trafficError,
    collaboratorsError,
    refreshWorkspaceData,
  };
}

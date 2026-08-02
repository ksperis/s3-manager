/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { getPortalBillingMe, type BillingSubjectDetail } from "../../api/billing";
import type { BucketUsageStatsAggregate } from "../../api/bucketUsageStats";
import type { HealthCheckStatus } from "../../api/healthchecks";
import { fetchPortalUsageHistoryTrends, getPortalUsageStatsAggregate } from "../../api/portal";
import type { TrafficWindow } from "../../api/stats";
import type { UsageHistoryTrendResponse, UsageHistoryTrendWindow } from "../../api/usageHistory";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import MetricsTrafficOverview, { MetricsSnapshotCard, MetricsSummaryCard } from "../../components/MetricsTrafficOverview";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageShell from "../../components/PageShell";
import UsageBreakdown from "../../components/UsageBreakdown";
import UsageHistoryTrendsSection from "../../components/UsageHistoryTrendsSection";
import { WorkspaceStatusDot } from "../../components/WorkspaceDashboardKit";
import UiBadge from "../../components/ui/UiBadge";
import { cx, uiCardMutedClass, uiInputClass, uiLabelClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";
import { formatPortalCurrency } from "./portalI18n";
import {
  portalActivitySourceTitle,
  portalTrafficLabels,
  portalUsageCompositionLabels,
} from "./portalStatisticsLabels";
import { PortalPageState } from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type PortalUsageTab = "storage" | "storage-spaces" | "usage-composition" | "usage-history" | "traffic" | "billing";

function currentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function percent(used?: number | null, quota?: number | null): number | null {
  if (used == null || quota == null || quota <= 0) return null;
  return Math.min(100, Math.max(0, (used / quota) * 100));
}

function backendStatusFromHealth(health: ReturnType<typeof usePortalWorkspaceData>["health"]): HealthCheckStatus {
  if (!health || health.endpoint_count <= 0) return "unknown";
  if (health.down_count > 0) return "down";
  if (health.degraded_count > 0) return "degraded";
  if (health.up_count > 0) return "up";
  return "unknown";
}

function backendStatusTone(status: HealthCheckStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "up") return "success";
  if (status === "degraded") return "warning";
  if (status === "down") return "danger";
  return "neutral";
}

function backendStatusLabel(status: HealthCheckStatus, t: ReturnType<typeof useI18n>["t"]): string {
  if (status === "up") return t({ en: "Operational", fr: "Opérationnel", de: "Betriebsbereit" });
  if (status === "degraded") return t({ en: "Degraded", fr: "Dégradé", de: "Beeinträchtigt" });
  if (status === "down") return t({ en: "Issue", fr: "Incident", de: "Problem" });
  return t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" });
}

function backendStatusHint(status: HealthCheckStatus, t: ReturnType<typeof useI18n>["t"]): string {
  if (status === "up") return t({ en: "The storage service is responding normally.", fr: "Le service de stockage répond normalement.", de: "Der Speicherdienst antwortet normal." });
  if (status === "degraded") return t({ en: "Some storage checks are degraded.", fr: "Certains contrôles du stockage sont dégradés.", de: "Einige Speicherprüfungen sind beeinträchtigt." });
  if (status === "down") return t({ en: "Some storage checks are failing.", fr: "Certains contrôles du stockage échouent.", de: "Einige Speicherprüfungen schlagen fehl." });
  return t({ en: "No recent backend check is available.", fr: "Aucun contrôle récent du backend n'est disponible.", de: "Keine aktuelle Backend-Prüfung verfügbar." });
}

function formatBackendTimestamp(value: string | null | undefined, locale: ReturnType<typeof useI18n>["locale"]): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function PortalUsagePage() {
  const { locale, t } = useI18n();
  const { generalSettings } = useGeneralSettings();
  const [month, setMonth] = useState(currentMonth());
  const [activeTab, setActiveTab] = useState<PortalUsageTab>("storage");
  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>("week");
  const [usageHistoryWindow, setUsageHistoryWindow] = useState<UsageHistoryTrendWindow>("month");
  const [billing, setBilling] = useState<BillingSubjectDetail | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingUnavailable, setBillingUnavailable] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageHistoryTrends, setUsageHistoryTrends] = useState<UsageHistoryTrendResponse | null>(null);
  const [usageHistoryLoading, setUsageHistoryLoading] = useState(false);
  const [usageHistoryError, setUsageHistoryError] = useState<string | null>(null);
  const {
    workspace,
    storageSpaces,
    usage,
    usageLoading,
    usageError,
    traffic,
    trafficLoading,
    trafficError,
    health,
    healthLoading,
    loading,
    error,
    accountError,
    accountLoading,
    hasAccountContext,
    accountIdForApi,
    selectedAccount,
    state,
  } = usePortalWorkspaceData({ includeUsage: true, includeTraffic: true, includeHealth: true, trafficWindow });

  const tabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: t({ en: "Overview", fr: "Vue d'ensemble", de: "Überblick" }) },
        { id: "storage-spaces" as const, label: t({ en: "By space", fr: "Par espace", de: "Nach Bereich" }) },
        ...(generalSettings.bucket_usage_stats_enabled ? [{ id: "usage-composition" as const, label: t({ en: "File types", fr: "Types de fichiers", de: "Dateitypen" }) }] : []),
        ...(generalSettings.usage_history_enabled ? [{ id: "usage-history" as const, label: t({ en: "Trends", fr: "Tendances", de: "Trends" }) }] : []),
        { id: "traffic" as const, label: t({ en: "Uploads & downloads", fr: "Envois et téléchargements", de: "Uploads & Downloads" }) },
        ...(generalSettings.billing_enabled ? [{ id: "billing" as const, label: t({ en: "Costs", fr: "Coûts", de: "Kosten" }) }] : []),
      ],
    [generalSettings.billing_enabled, generalSettings.bucket_usage_stats_enabled, generalSettings.usage_history_enabled, t]
  );

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0]?.id ?? "storage");
    }
  }, [activeTab, tabs]);

  useEffect(() => {
    let cancelled = false;
    if (!generalSettings.bucket_usage_stats_enabled || !hasAccountContext || !accountIdForApi) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      setUsageStatsError(null);
      return () => {
        cancelled = true;
      };
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    getPortalUsageStatsAggregate(accountIdForApi)
      .then((data) => {
        if (!cancelled) setUsageStatsAggregate(data.aggregate);
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageStatsAggregate(null);
          setUsageStatsError(extractApiError(err, t({ en: "Unable to load usage composition.", fr: "Impossible de charger la composition d'utilisation.", de: "Nutzungszusammensetzung kann nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setUsageStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.bucket_usage_stats_enabled, hasAccountContext, t]);

  useEffect(() => {
    let cancelled = false;
    if (!generalSettings.usage_history_enabled || !hasAccountContext || !accountIdForApi) {
      setUsageHistoryTrends(null);
      setUsageHistoryLoading(false);
      setUsageHistoryError(null);
      return () => {
        cancelled = true;
      };
    }
    setUsageHistoryLoading(true);
    setUsageHistoryError(null);
    fetchPortalUsageHistoryTrends(accountIdForApi, usageHistoryWindow)
      .then((data) => {
        if (!cancelled) setUsageHistoryTrends(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageHistoryTrends(null);
          setUsageHistoryError(extractApiError(err, t({ en: "Unable to load usage history trends.", fr: "Impossible de charger les tendances d'historique d'utilisation.", de: "Nutzungsverlaufstrends können nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setUsageHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.usage_history_enabled, hasAccountContext, t, usageHistoryWindow]);

  useEffect(() => {
    let cancelled = false;
    if (!generalSettings.billing_enabled || !hasAccountContext || !accountIdForApi || !month) {
      setBilling(null);
      setBillingLoading(false);
      setBillingUnavailable(false);
      setBillingError(null);
      return () => {
        cancelled = true;
      };
    }
    setBillingLoading(true);
    setBillingUnavailable(false);
    setBillingError(null);
    getPortalBillingMe(month, accountIdForApi)
      .then((data) => {
        if (!cancelled) setBilling(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setBilling(null);
          setBillingUnavailable(true);
          setBillingError(extractApiError(err, t({ en: "Unable to load billing source.", fr: "Impossible de charger la source de facturation.", de: "Abrechnungsquelle kann nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.billing_enabled, hasAccountContext, month, t]);

  const storageBySpace = useMemo(() => {
    const usageSpaces = usage?.storage_spaces ?? [];
    if (usageSpaces.length > 0) {
      return usageSpaces
        .map((space) => ({
          id: space.id,
          name: space.name,
          usedBytes: space.used_bytes ?? null,
          objectCount: space.object_count ?? null,
          quotaBytes: space.quota_max_size_bytes ?? null,
        }))
        .filter((space) => space.usedBytes != null || space.objectCount != null);
    }
    const apiSpaces = storageSpaces ?? [];
    return apiSpaces
      .map((space) => {
        const workspaceSpace = workspace.spaces.find((item) => item.id === space.id);
        return {
          id: space.id,
          name: workspaceSpace?.name ?? space.name,
          usedBytes: space.used_bytes ?? null,
          objectCount: space.object_count ?? null,
          quotaBytes: space.quota_max_size_bytes ?? null,
        };
      })
      .filter((space) => space.usedBytes != null || space.objectCount != null);
  }, [storageSpaces, usage?.storage_spaces, workspace.spaces]);

  const storageSpaceItems = useMemo(
    () =>
      storageBySpace.map((space) => ({
        id: space.id,
        label: space.name,
        usedBytes: space.usedBytes,
        objectCount: space.objectCount,
      })),
    [storageBySpace]
  );

  const totalUsedBytes =
    usage?.used_bytes ??
    (storageBySpace.some((space) => space.usedBytes != null)
      ? storageBySpace.reduce((sum, space) => sum + (space.usedBytes ?? 0), 0)
      : state?.used_bytes ?? workspace.usedBytes ?? null);
  const totalObjects =
    usage?.used_objects ??
    (storageBySpace.some((space) => space.objectCount != null)
      ? storageBySpace.reduce((sum, space) => sum + (space.objectCount ?? 0), 0)
      : state?.used_objects ?? workspace.usedObjects ?? null);
  const quotaBytes = usage?.quota_max_size_bytes ?? state?.quota_max_size_bytes ?? workspace.quotaBytes ?? null;
  const quotaObjects = usage?.quota_max_objects ?? state?.quota_max_objects ?? workspace.quotaObjects ?? null;
  const quotaPercent = percent(totalUsedBytes, quotaBytes);
  const objectQuotaPercent = percent(totalObjects, quotaObjects);
  const remainingBytes =
    totalUsedBytes != null && quotaBytes != null && quotaBytes >= 0
      ? Math.max(0, quotaBytes - totalUsedBytes)
      : null;
  const storageSpaceCount = workspace.spaces.length || storageSpaces?.length || 0;
  const billingUsage = billing?.usage ?? null;
  const cost = billing?.cost ?? null;
  const billingCoverage = billing?.coverage ?? null;
  const trafficMissing = !traffic && !trafficLoading && !trafficError;
  const backendStatus = backendStatusFromHealth(health);
  const backendIssueCount = (health?.down_count ?? 0) + (health?.degraded_count ?? 0);
  const bucketRankingLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    workspace.spaces.forEach((space) => {
      labels[space.id] = space.name;
      if (space.internalName) {
        labels[space.internalName] = space.name;
      }
    });
    return labels;
  }, [workspace.spaces]);
  const userRankingLabels = useMemo(() => {
    const rgwAccountId = selectedAccount?.rgw_account_id?.trim();
    return rgwAccountId ? { [rgwAccountId]: workspace.accountName } : {};
  }, [selectedAccount?.rgw_account_id, workspace.accountName]);

  const billingMonthControl = (
    <label className={cx(uiCardMutedClass, "flex h-9 items-center gap-2 px-3 ui-caption font-semibold", uiMutedTextClass)}>
      <span>{t({ en: "Month", fr: "Mois", de: "Monat" })}</span>
      <input
        type="month"
        value={month}
        onChange={(event) => setMonth(event.target.value)}
        className={cx(uiInputClass, "h-6 w-[120px] border-0 bg-transparent p-0 ui-caption font-semibold shadow-none")}
      />
    </label>
  );

  if (accountLoading || loading) {
    return <PortalPageState>{t({ en: "Loading storage health...", fr: "Chargement de l'état du stockage...", de: "Speicherstatus wird geladen..." })}</PortalPageState>;
  }

  if (accountError || error) {
    return <PortalPageState tone="error">{accountError ?? error}</PortalPageState>;
  }

  if (!hasAccountContext) {
    return (
      <div className="space-y-4">
        <PageEmptyState
          title={t({ en: "Select a project to view storage health", fr: "Sélectionnez un projet pour voir l'état du stockage", de: "Wählen Sie ein Projekt aus, um den Speicherstatus anzuzeigen" })}
          description={t({ en: "Storage room, space usage, transfer activity, and costs belong to the selected project.", fr: "L'espace disponible, l'utilisation par espace, l'activité de transfert et les coûts dépendent du projet sélectionné.", de: "Speicherplatz, Bereichsnutzung, Transferaktivität und Kosten gehören zum ausgewählten Projekt." })}
          tone="warning"
        />
      </div>
    );
  }

  return (
    <PageShell
        title={t({ en: "Storage health", fr: "État du stockage", de: "Speicherstatus" })}
        description={t({ en: "See how much room is left, which spaces are growing, and how files move in this workspace.", fr: "Voyez l'espace restant, les espaces qui grandissent et la façon dont les fichiers circulent dans ce workspace.", de: "Sehen Sie, wie viel Platz bleibt, welche Bereiche wachsen und wie Dateien in diesem Workspace bewegt werden." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Storage health", fr: "État du stockage", de: "Speicherstatus" }) })}
        actions={[
          { label: t({ en: "Open spaces", fr: "Ouvrir les espaces", de: "Bereiche öffnen" }), to: "/portal/storage-spaces", variant: "secondary" },
        ]}
    >

      <PortalPageTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(tab) => setActiveTab(tab as PortalUsageTab)}
        ariaLabel={t({ en: "Storage health views", fr: "Vues de l'état du stockage", de: "Ansichten des Speicherstatus" })}
        idPrefix="portal-storage-health"
      />

      <PortalTabPanel idPrefix="portal-storage-health" tabId={activeTab} className="space-y-4">
      {activeTab === "storage" ? (
        <div className="space-y-4">
          <MetricsSummaryCard
            title={t({ en: "Room and files", fr: "Espace et fichiers", de: "Platz und Dateien" })}
            description={t({ en: "Current storage, file count, and remaining room for this workspace.", fr: "Stockage actuel, nombre de fichiers et espace restant pour ce workspace.", de: "Aktueller Speicher, Dateianzahl und verbleibender Platz für diesen Workspace." })}
          >
            {usageError ? (
              <PageBanner tone="warning">{t({ en: "Usage data is unavailable from storage metrics. Available workspace data is still shown.", fr: "Les données d'utilisation sont indisponibles depuis les métriques de stockage. Les données disponibles de l'espace de travail restent affichées.", de: "Nutzungsdaten sind aus Speichermetriken nicht verfügbar. Verfügbare Arbeitsbereichsdaten werden weiterhin angezeigt." })}</PageBanner>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricsSnapshotCard
                label={t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher" })}
                value={formatBytes(totalUsedBytes)}
                hint={quotaPercent == null ? t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar" }) : t({ en: `${formatPercentage(quotaPercent)} of quota`, fr: `${formatPercentage(quotaPercent)} du quota`, de: `${formatPercentage(quotaPercent)} der Quote` })}
                loading={usageLoading}
              />
              <MetricsSnapshotCard
                label={t({ en: "Room left", fr: "Espace restant", de: "Verbleibender Platz" })}
                value={formatBytes(remainingBytes)}
                hint={quotaBytes == null ? t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar" }) : t({ en: `${formatBytes(quotaBytes)} total`, fr: `${formatBytes(quotaBytes)} au total`, de: `${formatBytes(quotaBytes)} insgesamt` })}
                loading={usageLoading}
              />
              <MetricsSnapshotCard
                label={t({ en: "Files", fr: "Fichiers", de: "Dateien" })}
                value={formatCompactNumber(totalObjects)}
                hint={objectQuotaPercent == null ? (totalObjects == null ? t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" }) : t({ en: "Tracked", fr: "Suivis", de: "Erfasst" })) : t({ en: `${formatPercentage(objectQuotaPercent)} of file quota`, fr: `${formatPercentage(objectQuotaPercent)} du quota de fichiers`, de: `${formatPercentage(objectQuotaPercent)} der Dateiquote` })}
                loading={usageLoading}
              />
              <MetricsSnapshotCard
                label={t({ en: "Spaces", fr: "Espaces", de: "Bereiche" })}
                value={formatCompactNumber(storageSpaceCount)}
                hint={t({ en: "Visible here", fr: "Visibles ici", de: "Hier sichtbar" })}
                loading={usageLoading}
              />
            </div>
          </MetricsSummaryCard>

          <MetricsCard
            title={t({ en: "Backend status", fr: "Statut du backend", de: "Backend-Status" })}
            description={t({ en: "Current availability of the storage service used by this workspace.", fr: "Disponibilité actuelle du service de stockage utilisé par ce workspace.", de: "Aktuelle Verfügbarkeit des Speicherdienstes für diesen Workspace." })}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={cx(uiCardMutedClass, "px-4 py-3")}>
                <div className="flex items-center justify-between gap-3">
                  <p className={uiLabelClass}>{t({ en: "Backend status", fr: "Statut du backend", de: "Backend-Status" })}</p>
                  {!healthLoading ? (
                    <UiBadge tone={backendStatusTone(backendStatus)} className="rounded-md px-2 py-0 text-[11px] leading-5">
                      {backendStatusLabel(backendStatus, t)}
                    </UiBadge>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {!healthLoading ? <WorkspaceStatusDot status={backendStatus} className="h-2.5 w-2.5 shrink-0" /> : null}
                  <p className={cx("ui-subtitle", uiTitleTextClass)}>{healthLoading ? "..." : backendStatusLabel(backendStatus, t)}</p>
                </div>
                <p className={cx("ui-caption", uiMutedTextClass)}>
                  {healthLoading ? t({ en: "Checking storage service status...", fr: "Vérification du statut du service de stockage...", de: "Status des Speicherdienstes wird geprüft..." }) : backendStatusHint(backendStatus, t)}
                </p>
              </div>
              <MetricsSnapshotCard
                label={t({ en: "Monitored services", fr: "Services surveillés", de: "Überwachte Dienste" })}
                value={formatCompactNumber(health?.endpoint_count ?? 0)}
                hint={t({ en: "Linked to this workspace", fr: "Liés à ce workspace", de: "Mit diesem Workspace verknüpft" })}
                loading={healthLoading}
              />
              <MetricsSnapshotCard
                label={t({ en: "Current issues", fr: "Incidents en cours", de: "Aktuelle Probleme" })}
                value={formatCompactNumber(backendIssueCount)}
                hint={t({ en: "Down or degraded checks", fr: "Contrôles en panne ou dégradés", de: "Ausgefallene oder beeinträchtigte Prüfungen" })}
                loading={healthLoading}
              />
              <MetricsSnapshotCard
                label={t({ en: "Last check", fr: "Dernier contrôle", de: "Letzte Prüfung" })}
                value={formatBackendTimestamp(health?.generated_at, locale)}
                hint={t({ en: "Latest backend reading", fr: "Dernière mesure du backend", de: "Letzte Backend-Messung" })}
                loading={healthLoading}
              />
            </div>
          </MetricsCard>
        </div>
      ) : null}

      {activeTab === "storage-spaces" ? (
        <MetricsCard
          title={t({ en: "Space breakdown", fr: "Répartition par espace", de: "Bereichsaufteilung" })}
          description={t({ en: "See which spaces use the most room or contain the most files.", fr: "Voyez les espaces qui utilisent le plus d'espace ou contiennent le plus de fichiers.", de: "Sehen Sie, welche Bereiche den meisten Platz nutzen oder die meisten Dateien enthalten." })}
        >
          {usageError ? (
            <PageBanner tone="warning">{t({ en: "Per-space usage metrics are unavailable. Stored Storage Space metadata is still shown when present.", fr: "Les métriques par espace sont indisponibles. Les métadonnées d'espace stockées restent affichées si elles existent.", de: "Nutzungsmetriken pro Bereich sind nicht verfügbar. Gespeicherte Metadaten werden weiterhin angezeigt, wenn vorhanden." })}</PageBanner>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-2">
            <UsageBreakdown
              title={t({ en: "Spaces by stored data", fr: "Espaces par données stockées", de: "Bereiche nach gespeicherten Daten" })}
              loading={usageLoading}
              metric="bytes"
              items={storageSpaceItems}
              emptyMessage={t({ en: "No per-space storage data yet.", fr: "Aucune donnée de stockage par espace pour le moment.", de: "Noch keine Speicherdaten pro Bereich." })}
              objectUnitLabel={t({ en: "files", fr: "fichiers", de: "Dateien" })}
            />
            <UsageBreakdown
              title={t({ en: "Spaces by files", fr: "Espaces par fichiers", de: "Bereiche nach Dateien" })}
              loading={usageLoading}
              metric="objects"
              items={storageSpaceItems}
              emptyMessage={t({ en: "No per-space file counts yet.", fr: "Aucun nombre de fichiers par espace pour le moment.", de: "Noch keine Dateizahlen pro Bereich." })}
              objectUnitLabel={t({ en: "files", fr: "fichiers", de: "Dateien" })}
            />
          </div>
        </MetricsCard>
      ) : null}

      {activeTab === "usage-composition" ? (
        <BucketUsageStatsAggregateCard
          title={t({ en: "File types and size mix", fr: "Types et tailles de fichiers", de: "Dateitypen und Größenmix" })}
          description={t({ en: "Latest breakdown of visible files by type, size, and storage class when collection is available.", fr: "Dernière répartition des fichiers visibles par type, taille et classe de stockage lorsque la collecte est disponible.", de: "Aktuelle Aufteilung sichtbarer Dateien nach Typ, Größe und Speicherklasse, wenn die Erfassung verfügbar ist." })}
          aggregate={usageStatsAggregate}
          loading={usageStatsLoading}
          error={usageStatsError}
          recalculateLabel={t({ en: "Recalculate", fr: "Recalculer", de: "Neu berechnen" })}
          coverageItemLabel={t({ en: "spaces", fr: "espaces", de: "Bereiche" })}
          emptyTitle={t({ en: "No file-type breakdown yet.", fr: "Aucune répartition par type pour le moment.", de: "Noch keine Dateityp-Aufteilung." })}
          emptyDescription={t({ en: "The platform prepares this view automatically when file composition collection is available.", fr: "La plateforme prépare cette vue automatiquement lorsque la collecte de composition est disponible.", de: "Die Plattform erstellt diese Ansicht automatisch, wenn die Dateizusammensetzung erfasst wird." })}
          compositionLabels={portalUsageCompositionLabels(t)}
        />
      ) : null}

      {activeTab === "usage-history" ? (
        <UsageHistoryTrendsSection
          trends={usageHistoryTrends}
          window={usageHistoryWindow}
          onWindowChange={setUsageHistoryWindow}
          loading={usageHistoryLoading}
          error={usageHistoryError}
          title={t({ en: "Growth over time", fr: "Évolution dans le temps", de: "Entwicklung im Zeitverlauf" })}
          description={t({ en: "Stored snapshots that show whether files and storage are growing.", fr: "Instantanés stockés qui montrent si les fichiers et le stockage augmentent.", de: "Gespeicherte Momentaufnahmen, die zeigen, ob Dateien und Speicher wachsen." })}
          labels={{
            unavailableDescription: t({ en: "Storage trend snapshots over time.", fr: "Instantanés d'évolution du stockage dans le temps.", de: "Speichertrend-Momentaufnahmen im Zeitverlauf." }),
            latestStorage: t({ en: "Latest storage", fr: "Dernier stockage", de: "Neuester Speicher" }),
            latestStorageHint: t({ en: "Latest reading", fr: "Dernière mesure", de: "Neuester Messwert" }),
            latestObjects: t({ en: "Latest files", fr: "Derniers fichiers", de: "Neueste Dateien" }),
            latestObjectsHint: t({ en: "Visible spaces", fr: "Espaces visibles", de: "Sichtbare Bereiche" }),
            maxQuotaRatio: t({ en: "Highest quota use", fr: "Plus forte utilisation du quota", de: "Höchste Quotennutzung" }),
            maxQuotaHint: t({ en: "Peak point", fr: "Point le plus haut", de: "Höchstwert" }),
            snapshots: t({ en: "Readings", fr: "Mesures", de: "Messwerte" }),
            snapshotsHint: t({ en: "Collected periods", fr: "Périodes collectées", de: "Erfasste Zeiträume" }),
            storageChartTitle: t({ en: "Storage growth", fr: "Croissance du stockage", de: "Speicherwachstum" }),
            storageChartSubtitle: t({ en: "Stored data over time", fr: "Données stockées dans le temps", de: "Gespeicherte Daten im Zeitverlauf" }),
            inventoryChartTitle: t({ en: "Files & spaces", fr: "Fichiers et espaces", de: "Dateien & Bereiche" }),
            inventoryChartSubtitle: t({ en: "File counts over time", fr: "Nombre de fichiers dans le temps", de: "Dateizahlen im Zeitverlauf" }),
            storageLineName: t({ en: "Storage", fr: "Stockage", de: "Speicher" }),
            objectLineName: t({ en: "Files", fr: "Fichiers", de: "Dateien" }),
            bucketLineName: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }),
            emptyMessage: t({ en: "No storage trend readings for this window yet.", fr: "Aucune mesure d'évolution du stockage pour cette période.", de: "Noch keine Speichertrend-Messwerte für dieses Fenster." }),
          }}
        />
      ) : null}

      {activeTab === "traffic" ? (
        <MetricsTrafficOverview
          title={t({ en: "Transfer activity", fr: "Activité de transfert", de: "Übertragungsaktivität" })}
          traffic={traffic}
          window={trafficWindow}
          onWindowChange={setTrafficWindow}
          loading={trafficLoading}
          error={trafficError}
          showEmpty={trafficMissing}
          description={t({ en: "How files moved in and out of this workspace.", fr: "Comment les fichiers sont entrés et sortis de ce workspace.", de: "Wie Dateien in diesen Workspace hinein- und hinausbewegt wurden." })}
          bucketRankingTitle={t({ en: "Most active Storage Spaces", fr: "Espaces de stockage les plus actifs", de: "Aktivste Speicherbereiche" })}
          userRankingTitle={portalActivitySourceTitle(t)}
          bucketRankingLabels={bucketRankingLabels}
          userRankingLabels={userRankingLabels}
          labels={portalTrafficLabels(t)}
        />
      ) : null}

      {activeTab === "billing" ? (
        <MetricsCard
          title={t({ en: "Monthly cost", fr: "Coût mensuel", de: "Monatliche Kosten" })}
          description={t({ en: "Estimated storage and transfer cost for the selected month.", fr: "Coût estimé du stockage et des transferts pour le mois sélectionné.", de: "Geschätzte Speicher- und Transferkosten für den ausgewählten Monat." })}
          actions={billingMonthControl}
        >
          {billingLoading && !billing ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricsSnapshotCard label={t({ en: "Estimated cost", fr: "Coût estimé", de: "Geschätzte Kosten" })} value="-" loading />
              <MetricsSnapshotCard label={t({ en: "Average storage", fr: "Stockage moyen", de: "Durchschnittlicher Speicher" })} value="-" loading />
              <MetricsSnapshotCard label={t({ en: "File actions", fr: "Actions fichier", de: "Dateiaktionen" })} value="-" loading />
              <MetricsSnapshotCard label={t({ en: "Coverage", fr: "Couverture", de: "Abdeckung" })} value="-" loading />
            </div>
          ) : billing ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricsSnapshotCard
                  label={t({ en: "Estimated cost", fr: "Coût estimé", de: "Geschätzte Kosten" })}
                  value={formatPortalCurrency(cost?.total_cost, cost?.currency, locale)}
                  hint={cost?.currency ?? t({ en: "Billing currency", fr: "Devise de facturation", de: "Abrechnungswährung" })}
                  loading={billingLoading}
                />
                <MetricsSnapshotCard
                  label={t({ en: "Average storage", fr: "Stockage moyen", de: "Durchschnittlicher Speicher" })}
                  value={formatBytes(billing.storage.avg_bytes)}
                  hint={t({ en: `${formatCompactNumber(billing.storage.total_objects)} files`, fr: `${formatCompactNumber(billing.storage.total_objects)} fichiers`, de: `${formatCompactNumber(billing.storage.total_objects)} Dateien` })}
                  loading={billingLoading}
                />
                <MetricsSnapshotCard
                  label={t({ en: "File actions", fr: "Actions fichier", de: "Dateiaktionen" })}
                  value={formatCompactNumber(billingUsage?.ops_total)}
                  hint={t({ en: `${formatBytes(billingUsage?.bytes_out)} downloaded, ${formatBytes(billingUsage?.bytes_in)} uploaded`, fr: `${formatBytes(billingUsage?.bytes_out)} téléchargés, ${formatBytes(billingUsage?.bytes_in)} envoyés`, de: `${formatBytes(billingUsage?.bytes_out)} heruntergeladen, ${formatBytes(billingUsage?.bytes_in)} hochgeladen` })}
                  loading={billingLoading}
                />
                <MetricsSnapshotCard
                  label={t({ en: "Coverage", fr: "Couverture", de: "Abdeckung" })}
                  value={billingCoverage ? t({ en: `${billingCoverage.days_collected}/${billingCoverage.days_in_month} days`, fr: `${billingCoverage.days_collected}/${billingCoverage.days_in_month} jours`, de: `${billingCoverage.days_collected}/${billingCoverage.days_in_month} Tage` }) : "-"}
                  hint={billingCoverage ? formatPercentage(billingCoverage.coverage_ratio * 100) : t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" })}
                  loading={billingLoading}
                />
              </div>
              <div className={cx(uiCardMutedClass, "px-4 py-3")}>
                <p className={cx("ui-caption font-semibold", uiMutedTextClass)}>{t({ en: "Rate card", fr: "Grille tarifaire", de: "Tarifkarte" })}</p>
                <p className={cx("ui-body font-semibold", uiTitleTextClass)}>
                  {cost?.rate_card_name ? cost.rate_card_name : t({ en: "No rate card attached.", fr: "Aucune grille tarifaire associée.", de: "Keine Tarifkarte zugeordnet." })}
                </p>
              </div>
            </>
          ) : (
            <MetricsEmptyState>
              {billingUnavailable
                ? billingError ?? t({ en: "Billing source is disabled or unavailable.", fr: "La source de facturation est désactivée ou indisponible.", de: "Abrechnungsquelle ist deaktiviert oder nicht verfügbar." })
                : t({ en: "No billing source data available.", fr: "Aucune donnée de source de facturation disponible.", de: "Keine Daten aus der Abrechnungsquelle verfügbar." })}
            </MetricsEmptyState>
          )}
        </MetricsCard>
      ) : null}
      </PortalTabPanel>
    </PageShell>
  );
}

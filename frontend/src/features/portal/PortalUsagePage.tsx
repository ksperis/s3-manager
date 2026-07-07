/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { getPortalBillingMe, type BillingSubjectDetail } from "../../api/billing";
import type { BucketUsageStatsAggregate } from "../../api/bucketUsageStats";
import { fetchPortalUsageHistoryTrends, getPortalUsageStatsAggregate } from "../../api/portal";
import type { TrafficWindow } from "../../api/stats";
import type { UsageHistoryTrendResponse, UsageHistoryTrendWindow } from "../../api/usageHistory";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import MetricsTrafficOverview, { MetricsSnapshotCard, MetricsSummaryCard } from "../../components/MetricsTrafficOverview";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import UsageBreakdown from "../../components/UsageBreakdown";
import UsageHistoryTrendsSection from "../../components/UsageHistoryTrendsSection";
import { cx, uiCardMutedClass, uiDividerClass, uiInputClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { formatPortalCurrency } from "./portalI18n";
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
    loading,
    error,
    accountError,
    accountLoading,
    hasAccountContext,
    accountIdForApi,
    state,
  } = usePortalWorkspaceData({ includeTraffic: true, trafficWindow });

  const tabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: t({ en: "Storage", fr: "Stockage", de: "Speicher" }) },
        { id: "storage-spaces" as const, label: t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }) },
        ...(generalSettings.bucket_usage_stats_enabled ? [{ id: "usage-composition" as const, label: t({ en: "Usage composition", fr: "Composition de l'utilisation", de: "Nutzungszusammensetzung" }) }] : []),
        ...(generalSettings.usage_history_enabled ? [{ id: "usage-history" as const, label: t({ en: "Usage history", fr: "Historique d'utilisation", de: "Nutzungsverlauf" }) }] : []),
        { id: "traffic" as const, label: t({ en: "Traffic", fr: "Trafic", de: "Traffic" }) },
        ...(generalSettings.billing_enabled ? [{ id: "billing" as const, label: t({ en: "Billing", fr: "Facturation", de: "Abrechnung" }) }] : []),
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
  const storageSpaceCount = workspace.spaces.length || storageSpaces?.length || 0;
  const billingUsage = billing?.usage ?? null;
  const cost = billing?.cost ?? null;
  const billingCoverage = billing?.coverage ?? null;
  const trafficMissing = !traffic && !trafficLoading && !trafficError;

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
    return <PortalPageState>{t({ en: "Loading analytics...", fr: "Chargement des analyses...", de: "Analysen werden geladen..." })}</PortalPageState>;
  }

  if (accountError || error) {
    return <PortalPageState tone="error">{accountError ?? error}</PortalPageState>;
  }

  if (!hasAccountContext) {
    return (
      <div className="space-y-4">
        <PageEmptyState
          title={t({ en: "Select an account to view analytics", fr: "Sélectionnez un compte pour voir les analyses", de: "Wählen Sie ein Konto aus, um Analysen anzuzeigen" })}
          description={t({ en: "Usage, traffic and billing analytics are attached to your selected portal account.", fr: "Les analyses d'utilisation, de trafic et de facturation sont liées au compte Portal sélectionné.", de: "Nutzungs-, Traffic- und Abrechnungsanalysen sind mit Ihrem ausgewählten Portal-Konto verknüpft." })}
          tone="warning"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Usage & Analytics", fr: "Utilisation et analyses", de: "Nutzung und Analysen" })}
        description={t({ en: "Track storage, traffic, requests and billing for this portal workspace.", fr: "Suivez le stockage, le trafic, les requêtes et la facturation de ce workspace Portal.", de: "Verfolgen Sie Speicher, Traffic, Anfragen und Abrechnung für diesen Portal-Arbeitsbereich." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Usage & Analytics", fr: "Utilisation et analyses", de: "Nutzung und Analysen" }) })}
      />

      <div className={cx("border-b pb-3", uiDividerClass)}>
        <PageTabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={(tab) => setActiveTab(tab as PortalUsageTab)}
          variant="bar"
        />
      </div>

      {activeTab === "storage" ? (
        <MetricsSummaryCard
          title={t({ en: "Storage snapshot", fr: "Instantané du stockage", de: "Speichermomentaufnahme" })}
          description={t({ en: "Current storage, file and quota usage for this portal account.", fr: "Utilisation actuelle du stockage, des fichiers et des quotas pour ce compte Portal.", de: "Aktuelle Speicher-, Datei- und Quotennutzung für dieses Portal-Konto." })}
        >
          {usageError ? (
            <PageBanner tone="warning">{t({ en: "Usage data is unavailable from storage metrics. Available workspace data is still shown.", fr: "Les données d'utilisation sont indisponibles depuis les métriques de stockage. Les données disponibles du workspace restent affichées.", de: "Nutzungsdaten sind aus Speichermetriken nicht verfügbar. Verfügbare Arbeitsbereichsdaten werden weiterhin angezeigt." })}</PageBanner>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricsSnapshotCard
              label={t({ en: "Stored volume", fr: "Volume stocké", de: "Gespeichertes Volumen" })}
              value={formatBytes(totalUsedBytes)}
              hint={quotaPercent == null ? t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar" }) : t({ en: `${formatPercentage(quotaPercent)} of quota`, fr: `${formatPercentage(quotaPercent)} du quota`, de: `${formatPercentage(quotaPercent)} der Quote` })}
              loading={usageLoading}
            />
            <MetricsSnapshotCard
              label={t({ en: "Files", fr: "Fichiers", de: "Dateien" })}
              value={formatCompactNumber(totalObjects)}
              hint={objectQuotaPercent == null ? (totalObjects == null ? t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" }) : t({ en: "Tracked", fr: "Suivis", de: "Erfasst" })) : t({ en: `${formatPercentage(objectQuotaPercent)} of file quota`, fr: `${formatPercentage(objectQuotaPercent)} du quota de fichiers`, de: `${formatPercentage(objectQuotaPercent)} der Dateiquote` })}
              loading={usageLoading}
            />
            <MetricsSnapshotCard
              label={t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" })}
              value={formatCompactNumber(storageSpaceCount)}
              hint={t({ en: "Visible in this workspace", fr: "Visibles dans ce workspace", de: "In diesem Arbeitsbereich sichtbar" })}
              loading={usageLoading}
            />
            <MetricsSnapshotCard
              label={t({ en: "Storage quota", fr: "Quota de stockage", de: "Speicherquote" })}
              value={formatBytes(quotaBytes)}
              hint={quotaBytes == null ? t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" }) : t({ en: `${formatBytes(totalUsedBytes)} used`, fr: `${formatBytes(totalUsedBytes)} utilisés`, de: `${formatBytes(totalUsedBytes)} genutzt` })}
              loading={usageLoading}
            />
          </div>
        </MetricsSummaryCard>
      ) : null}

      {activeTab === "storage-spaces" ? (
        <MetricsCard
          title={t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" })}
          description={t({ en: "Storage and file composition across the Storage Spaces you can access.", fr: "Composition du stockage et des fichiers pour les espaces de stockage auxquels vous avez accès.", de: "Speicher- und Dateizusammensetzung der Speicherbereiche, auf die Sie zugreifen können." })}
        >
          {usageError ? (
            <PageBanner tone="warning">{t({ en: "Per-space usage metrics are unavailable. Stored Storage Space metadata is still shown when present.", fr: "Les métriques par espace sont indisponibles. Les métadonnées d'espace stockées restent affichées si elles existent.", de: "Nutzungsmetriken pro Bereich sind nicht verfügbar. Gespeicherte Metadaten werden weiterhin angezeigt, wenn vorhanden." })}</PageBanner>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-2">
            <UsageBreakdown
              title={t({ en: "Storage Spaces (volume)", fr: "Espaces de stockage (volume)", de: "Speicherbereiche (Volumen)" })}
              loading={usageLoading}
              metric="bytes"
              items={storageSpaceItems}
              emptyMessage={t({ en: "No Storage Space volume metrics available.", fr: "Aucune métrique de volume disponible par espace de stockage.", de: "Keine Volumenmetriken für Speicherbereiche verfügbar." })}
            />
            <UsageBreakdown
              title={t({ en: "Storage Spaces (files)", fr: "Espaces de stockage (fichiers)", de: "Speicherbereiche (Dateien)" })}
              loading={usageLoading}
              metric="objects"
              items={storageSpaceItems}
              emptyMessage={t({ en: "No Storage Space file metrics available.", fr: "Aucune métrique de fichiers disponible par espace de stockage.", de: "Keine Dateimetriken für Speicherbereiche verfügbar." })}
            />
          </div>
        </MetricsCard>
      ) : null}

      {activeTab === "usage-composition" ? (
        <BucketUsageStatsAggregateCard
          title={t({ en: "Usage composition", fr: "Composition de l'utilisation", de: "Nutzungszusammensetzung" })}
          description={t({ en: "Latest calculated usage composition for the Storage Spaces visible in this portal account.", fr: "Dernière composition d'utilisation calculée pour les espaces de stockage visibles dans ce compte Portal.", de: "Zuletzt berechnete Nutzungszusammensetzung für die in diesem Portal-Konto sichtbaren Speicherbereiche." })}
          aggregate={usageStatsAggregate}
          loading={usageStatsLoading}
          error={usageStatsError}
          recalculateLabel={t({ en: "Recalculate", fr: "Recalculer", de: "Neu berechnen" })}
          coverageItemLabel={t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" })}
          emptyTitle={t({ en: "No usage composition snapshots yet.", fr: "Aucun instantané de composition d'utilisation pour le moment.", de: "Noch keine Momentaufnahmen der Nutzungszusammensetzung." })}
          emptyDescription={t({ en: "Snapshots are produced by the platform usage collection; no portal action is required.", fr: "Les instantanés sont produits par la collecte d'utilisation de la plateforme; aucune action Portal n'est requise.", de: "Momentaufnahmen werden von der Plattformnutzungserfassung erzeugt; keine Portal-Aktion ist erforderlich." })}
        />
      ) : null}

      {activeTab === "usage-history" ? (
        <UsageHistoryTrendsSection
          trends={usageHistoryTrends}
          window={usageHistoryWindow}
          onWindowChange={setUsageHistoryWindow}
          loading={usageHistoryLoading}
          error={usageHistoryError}
          description={t({ en: "Stored usage snapshots for the selected portal account.", fr: "Instantanés d'utilisation stockés pour le compte Portal sélectionné.", de: "Gespeicherte Nutzungsmomentaufnahmen für das ausgewählte Portal-Konto." })}
        />
      ) : null}

      {activeTab === "traffic" ? (
        <MetricsTrafficOverview
          title={t({ en: "Traffic", fr: "Trafic", de: "Traffic" })}
          traffic={traffic}
          window={trafficWindow}
          onWindowChange={setTrafficWindow}
          loading={trafficLoading}
          error={trafficError}
          showEmpty={trafficMissing}
          description={t({ en: "Uploads, downloads and requests for this portal account.", fr: "Envois, téléchargements et requêtes de ce compte Portal.", de: "Uploads, Downloads und Anfragen für dieses Portal-Konto." })}
          bucketRankingTitle={t({ en: "Most active Storage Spaces", fr: "Espaces de stockage les plus actifs", de: "Aktivste Speicherbereiche" })}
          userRankingTitle={t({ en: "Most active users", fr: "Utilisateurs les plus actifs", de: "Aktivste Benutzer" })}
        />
      ) : null}

      {activeTab === "billing" ? (
        <MetricsCard
          title={t({ en: "Billing", fr: "Facturation", de: "Abrechnung" })}
          description={t({ en: "Estimated monthly usage and cost for this portal account.", fr: "Utilisation et coût mensuels estimés pour ce compte Portal.", de: "Geschätzte monatliche Nutzung und Kosten für dieses Portal-Konto." })}
          actions={billingMonthControl}
        >
          {billingLoading && !billing ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricsSnapshotCard label={t({ en: "Estimated cost", fr: "Coût estimé", de: "Geschätzte Kosten" })} value="-" loading />
              <MetricsSnapshotCard label={t({ en: "Average storage", fr: "Stockage moyen", de: "Durchschnittlicher Speicher" })} value="-" loading />
              <MetricsSnapshotCard label={t({ en: "Requests", fr: "Requêtes", de: "Anfragen" })} value="-" loading />
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
                  label={t({ en: "Requests", fr: "Requêtes", de: "Anfragen" })}
                  value={formatCompactNumber(billingUsage?.ops_total)}
                  hint={t({ en: `${formatBytes(billingUsage?.bytes_out)} out, ${formatBytes(billingUsage?.bytes_in)} in`, fr: `${formatBytes(billingUsage?.bytes_out)} sortants, ${formatBytes(billingUsage?.bytes_in)} entrants`, de: `${formatBytes(billingUsage?.bytes_out)} ausgehend, ${formatBytes(billingUsage?.bytes_in)} eingehend` })}
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
    </div>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchPortalStorageSpaceUsageStats,
  fetchPortalTraffic,
  type PortalStorageSpaceUsageStatsSnapshot,
} from "../../api/portalUsage";
import type { ManagerTrafficStats, TrafficWindow } from "../../api/stats";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { MetricsCard, MetricsEmptyState, MetricsTile } from "../../components/MetricsCard";
import MetricsTrafficOverview from "../../components/MetricsTrafficOverview";
import PageBanner from "../../components/PageBanner";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { BucketUsageStatsCompositionVisuals } from "../shared/BucketUsageStatsVisuals";
import {
  portalActivitySourceTitle,
  portalTrafficLabels,
  portalUsageCompositionLabels,
} from "./portalStatisticsLabels";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";

type PortalStorageSpaceStatisticsProps = {
  accountIdForApi: S3AccountSelector;
  accountName: string;
  rgwAccountId?: string | null;
  space: PortalWorkspaceSpace;
};

export default function PortalStorageSpaceStatistics({
  accountIdForApi,
  accountName,
  rgwAccountId,
  space,
}: PortalStorageSpaceStatisticsProps) {
  const { locale, t } = useI18n();
  const { generalSettings } = useGeneralSettings();
  const [usageStatsSnapshot, setUsageStatsSnapshot] = useState<PortalStorageSpaceUsageStatsSnapshot | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>("week");
  const [spaceTraffic, setSpaceTraffic] = useState<ManagerTrafficStats | null>(null);
  const [spaceTrafficLoading, setSpaceTrafficLoading] = useState(false);
  const [spaceTrafficError, setSpaceTrafficError] = useState<string | null>(null);
  const isArchived = space.status === "Archived";
  const canBrowse = space.canBrowse && !isArchived;
  const bucketName = space.internalName ?? space.id;

  useEffect(() => {
    let cancelled = false;
    if (!generalSettings.bucket_usage_stats_enabled || !canBrowse) return;
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    fetchPortalStorageSpaceUsageStats(accountIdForApi, space.id)
      .then((payload) => {
        if (!cancelled) setUsageStatsSnapshot(payload.snapshot ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setUsageStatsSnapshot(null);
        setUsageStatsError(
          extractApiError(
            err,
            t({
              en: "Unable to load file composition.",
              fr: "Impossible de charger la composition des fichiers.",
              de: "Die Dateizusammensetzung konnte nicht geladen werden.",
            }),
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setUsageStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, canBrowse, generalSettings.bucket_usage_stats_enabled, space.id, t]);

  useEffect(() => {
    let cancelled = false;
    if (!canBrowse) return;
    setSpaceTrafficLoading(true);
    setSpaceTrafficError(null);
    fetchPortalTraffic(accountIdForApi, trafficWindow, bucketName)
      .then((payload) => {
        if (!cancelled) setSpaceTraffic(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setSpaceTraffic(null);
        setSpaceTrafficError(
          extractApiError(
            err,
            t({
              en: "Unable to load upload and download activity.",
              fr: "Impossible de charger l’activité d’envoi et de téléchargement.",
              de: "Upload- und Download-Aktivität konnten nicht geladen werden.",
            }),
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setSpaceTrafficLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, bucketName, canBrowse, t, trafficWindow]);

  const quotaPercent =
    space.quotaBytes != null && space.quotaBytes > 0 && space.usedBytes != null
      ? Math.min(100, (space.usedBytes / space.quotaBytes) * 100)
      : null;
  const remainingBytes =
    space.quotaBytes != null && space.usedBytes != null
      ? Math.max(0, space.quotaBytes - space.usedBytes)
      : null;
  const averageFileSize =
    space.usedBytes != null && space.objectCount != null && space.objectCount > 0
      ? space.usedBytes / space.objectCount
      : null;
  const normalizedRgwAccountId = rgwAccountId?.trim();

  return (
    <div className="space-y-4">
      <MetricsCard
        title={t({ en: "Space summary", fr: "Résumé de l’espace", de: "Bereichszusammenfassung" })}
        description={t({
          en: "Current storage, remaining room, and file inventory for this Storage Space.",
          fr: "Stockage actuel, espace restant et inventaire des fichiers de cet espace de stockage.",
          de: "Aktueller Speicher, verbleibender Platz und Dateibestand dieses Speicherbereichs.",
        })}
      >
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label={t({ en: "Space summary", fr: "Résumé de l’espace", de: "Bereichszusammenfassung" })}>
          <MetricsTile
            label={t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher" })}
            value={space.usedBytes == null ? "–" : formatBytes(space.usedBytes)}
            hint={quotaPercent == null ? t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar" }) : t({ en: `of ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)}%)`, fr: `sur ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)} %)`, de: `von ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)} %)` })}
          />
          <MetricsTile
            label={t({ en: "Room left", fr: "Espace restant", de: "Verbleibender Platz" })}
            value={remainingBytes == null ? "–" : formatBytes(remainingBytes)}
            hint={space.quotaBytes == null ? t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar" }) : t({ en: `${formatBytes(space.quotaBytes)} total`, fr: `${formatBytes(space.quotaBytes)} au total`, de: `${formatBytes(space.quotaBytes)} insgesamt` })}
          />
          <MetricsTile
            label={t({ en: "Files", fr: "Fichiers", de: "Dateien" })}
            value={space.objectCount == null ? "–" : formatCompactNumber(space.objectCount)}
            hint={space.objectCount == null ? t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" }) : t({ en: "Tracked", fr: "Suivis", de: "Erfasst" })}
          />
          <MetricsTile
            label={t({ en: "Average size", fr: "Taille moyenne", de: "Durchschnittsgröße" })}
            value={averageFileSize == null ? "–" : formatBytes(averageFileSize)}
            hint={averageFileSize == null ? t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" }) : t({ en: "per file", fr: "par fichier", de: "pro Datei" })}
          />
        </section>
      </MetricsCard>

      {!canBrowse ? (
        <PageBanner tone="warning">
          {isArchived
            ? t({
                en: "Detailed statistics are unavailable while this Storage Space is archived.",
                fr: "Les statistiques détaillées sont indisponibles tant que cet espace de stockage est archivé.",
                de: "Detaillierte Statistiken sind nicht verfügbar, solange dieser Speicherbereich archiviert ist.",
              })
            : t({
                en: "Content access is required to view file composition and transfer activity.",
                fr: "L’accès au contenu est requis pour consulter la composition des fichiers et l’activité de transfert.",
                de: "Für Dateizusammensetzung und Übertragungsaktivität ist Inhaltszugriff erforderlich.",
              })}
        </PageBanner>
      ) : (
        <>
          {generalSettings.bucket_usage_stats_enabled ? (
            <MetricsCard
              title={t({ en: "File composition", fr: "Composition des fichiers", de: "Dateizusammensetzung" })}
              description={t({
                en: "Latest stored snapshot for this Storage Space. It is collected automatically by the platform.",
                fr: "Dernier instantané enregistré pour cet espace de stockage. Il est collecté automatiquement par la plateforme.",
                de: "Letzte gespeicherte Momentaufnahme dieses Speicherbereichs. Sie wird automatisch von der Plattform erfasst.",
              })}
            >
              {usageStatsError ? <PageBanner tone="warning">{usageStatsError}</PageBanner> : null}
              {usageStatsLoading && !usageStatsSnapshot ? (
                <div className="h-72 animate-pulse rounded-md bg-[var(--ui-surface-muted)]" />
              ) : usageStatsSnapshot ? (
                <BucketUsageStatsCompositionVisuals
                  stats={usageStatsSnapshot}
                  finalMetric={{
                    label: t({ en: "Snapshot date", fr: "Date de l’instantané", de: "Zeitpunkt der Momentaufnahme" }),
                    value: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(usageStatsSnapshot.calculated_at)),
                    hint: t({ en: "Latest available", fr: "Dernier disponible", de: "Zuletzt verfügbar" }),
                  }}
                  currentVsNoncurrentEmptyMessage={t({
                    en: "Current and older version distribution is unavailable.",
                    fr: "La répartition des versions courantes et anciennes est indisponible.",
                    de: "Die Verteilung aktueller und älterer Versionen ist nicht verfügbar.",
                  })}
                  showVersionListingWarning={!usageStatsSnapshot.version_listing_available}
                  labels={portalUsageCompositionLabels(t)}
                />
              ) : (
                <MetricsEmptyState>
                  {t({
                    en: "No file-composition snapshot is available yet.",
                    fr: "Aucun instantané de composition des fichiers n’est encore disponible.",
                    de: "Noch keine Momentaufnahme der Dateizusammensetzung verfügbar.",
                  })}
                </MetricsEmptyState>
              )}
            </MetricsCard>
          ) : null}

          <MetricsTrafficOverview
            title={t({ en: "Transfer activity", fr: "Activité de transfert", de: "Übertragungsaktivität" })}
            traffic={spaceTraffic}
            window={trafficWindow}
            onWindowChange={setTrafficWindow}
            loading={spaceTrafficLoading}
            error={spaceTrafficError}
            showEmpty={!spaceTraffic && !spaceTrafficLoading && !spaceTrafficError}
            showBucketRanking={false}
            description={t({
              en: "Uploads and downloads for this Storage Space only.",
              fr: "Envois et téléchargements de cet espace de stockage uniquement.",
              de: "Nur Uploads und Downloads dieses Speicherbereichs.",
            })}
            userRankingTitle={portalActivitySourceTitle(t)}
            userRankingLabels={normalizedRgwAccountId ? { [normalizedRgwAccountId]: accountName } : undefined}
            labels={portalTrafficLabels(t)}
          />
        </>
      )}
    </div>
  );
}

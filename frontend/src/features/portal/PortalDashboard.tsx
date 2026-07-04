/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { HealthCheckStatus } from "../../api/healthchecks";
import type { PortalUsageStorageSpace } from "../../api/portal";
import type { ManagerUsageTrendBaseline } from "../../api/stats";
import PageHeader from "../../components/PageHeader";
import {
  buildWorkspaceStorageEvolutionPoints,
  WorkspaceDashboardCard,
  WorkspaceDashboardEmptyState,
  WorkspaceDashboardIconBubble as IconBubble,
  WorkspaceDashboardKpiRow as KpiRow,
  WorkspaceDashboardProgressBar as ProgressBar,
  WorkspaceDashboardStorageEvolutionChart,
  WorkspaceStatusDot,
  type WorkspaceDashboardTone,
} from "../../components/WorkspaceDashboardKit";
import {
  buildWorkspaceDashboardKpis,
  formatWorkspaceProjectedFull,
  formatWorkspaceSignedBytesDelta,
  selectWorkspaceTrafficTrend,
  workspaceStorageGrowthDelta,
  workspaceTrafficTotalBytes,
} from "../../components/workspaceDashboardKpis";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import UiBadge from "../../components/ui/UiBadge";
import { cx, uiCardClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n, type I18nMessage } from "../../i18n";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import {
  BucketCollectionIcon,
  BucketIcon,
  FileIcon,
  HistoryIcon,
  InfoIcon,
  LinkIcon,
  OpenIcon,
  TransferIcon,
  UploadIcon,
} from "../browser/browserIcons";
import { storageSpacePath, type PortalWorkspaceSpace, type PortalWorkspaceTransfer } from "./portalWorkspaceModel";
import {
  portalRoleTone,
  portalStorageSpaceStatusTone,
  portalTransferStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import {
  portalRoleLabel,
  portalStatusLabel,
  portalTrendPeriodLabel,
  portalTransferDirectionLabel,
  portalTransferStatusLabel,
} from "./portalI18n";

type StorageSpaceRow = {
  id: string;
  name: string;
  usedBytes?: number | null;
  objectCount?: number | null;
  quotaBytes?: number | null;
  role?: PortalWorkspaceSpace["role"];
  status?: PortalWorkspaceSpace["status"];
  space?: PortalWorkspaceSpace;
  isOther?: boolean;
  percent: number | null;
};

type ActivityRow = {
  id: string;
  label: string;
  detail: string;
  time: string;
  tone: WorkspaceDashboardTone;
  icon: ReactNode;
};

type TransferRow = {
  id: string;
  name: string;
  detail: string;
  status: PortalWorkspaceTransfer["status"];
  statusLabel: string;
  progress: number;
  tone: "neutral" | "primary" | "danger" | "success";
};

type QuickLink = {
  label: string;
  detail: string;
  to: string;
  tone: WorkspaceDashboardTone;
  icon: ReactNode;
};

const TOP_STORAGE_SPACES_LIMIT = 4;

function percent(used?: number | null, quota?: number | null): number | null {
  if (used == null || quota == null || quota <= 0) return null;
  return Math.max(0, Math.min(100, (used / quota) * 100));
}

function formatDashboardNumber(value?: number | null): string {
  if (value == null) return "-";
  return formatCompactNumber(value)
    .replace(/k$/, " K")
    .replace(/M$/, " M")
    .replace(/B$/, " B");
}

function alertTone(tone: string) {
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  if (tone === "info") return "primary";
  return "neutral";
}

function workspaceHealthStatus(
  health: ReturnType<typeof usePortalWorkspaceData>["health"]
): HealthCheckStatus {
  if (!health || health.endpoint_count <= 0) return "unknown";
  if (health.down_count > 0) return "down";
  if (health.degraded_count > 0) return "degraded";
  if (health.up_count > 0) return "up";
  return "unknown";
}

type TFunction = (message: I18nMessage) => string;

function workspaceHealthLabel(status: HealthCheckStatus, t: TFunction): string {
  if (status === "up") return t({ en: "Storage services operational", fr: "Services de stockage opérationnels", de: "Speicherdienste betriebsbereit" });
  if (status === "degraded") return t({ en: "Storage services degraded", fr: "Services de stockage dégradés", de: "Speicherdienste beeinträchtigt" });
  if (status === "down") return t({ en: "Storage service availability issue", fr: "Problème de disponibilité du service de stockage", de: "Verfügbarkeitsproblem des Speicherdienstes" });
  return t({ en: "Storage service status unavailable", fr: "Statut du service de stockage indisponible", de: "Status des Speicherdienstes nicht verfügbar" });
}

function localizeTrendBaseline<T extends ManagerUsageTrendBaseline | null | undefined>(baseline: T, t: TFunction): T {
  if (!baseline) return baseline;
  return {
    ...baseline,
    label: portalTrendPeriodLabel(baseline.label, t),
  } as T;
}

function hasOtherUsage(other?: PortalUsageStorageSpace | null): other is PortalUsageStorageSpace {
  return Boolean(other && ((other.used_bytes ?? 0) > 0 || (other.object_count ?? 0) > 0));
}

function buildStorageRows(spaces: PortalWorkspaceSpace[], other?: PortalUsageStorageSpace | null): StorageSpaceRow[] {
  const includeOther = hasOtherUsage(other);
  const namedLimit = includeOther ? TOP_STORAGE_SPACES_LIMIT - 1 : TOP_STORAGE_SPACES_LIMIT;
  const namedRows = [...spaces]
    .sort((left, right) => (right.usedBytes ?? 0) - (left.usedBytes ?? 0))
    .slice(0, namedLimit)
    .map((space) => ({
      id: space.id,
      name: space.name,
      usedBytes: space.usedBytes,
      objectCount: space.objectCount,
      quotaBytes: space.quotaBytes,
      role: space.role,
      status: space.status,
      space,
    }));
  const rows: Omit<StorageSpaceRow, "percent">[] = includeOther
    ? [
        ...namedRows,
        {
          id: other.id,
          name: other.name,
          usedBytes: other.used_bytes,
          objectCount: other.object_count,
          isOther: true,
        },
      ]
    : namedRows;
  const maxBytes = Math.max(...rows.map((row) => row.usedBytes ?? 0), 1);
  return rows.map((row) => {
    const quotaPercent = percent(row.usedBytes, row.quotaBytes);
    const rankingPercent = row.usedBytes == null ? null : Math.max(4, ((row.usedBytes ?? 0) / maxBytes) * 100);
    return { ...row, percent: quotaPercent ?? rankingPercent };
  });
}

function buildActivityRows(workspaceActivity: ReturnType<typeof usePortalWorkspaceData>["workspace"]["activity"], t: TFunction): ActivityRow[] {
  return workspaceActivity.slice(0, 5).map((item) => {
    const action = item.action.toLowerCase();
    const isShare = action.includes("share") || action.includes("partage") || action.includes("freigabe") || action.includes("link");
    const isTransfer =
      action.includes("upload") ||
      action.includes("download") ||
      action.includes("envoy") ||
      action.includes("télécharg") ||
      action.includes("hochgeladen") ||
      action.includes("heruntergeladen");
    return {
      id: item.id,
      label: t({ en: `${item.actor} ${action} ${item.target}`, fr: `${item.actor} ${action} ${item.target}`, de: `${item.actor} ${action} ${item.target}` }),
      detail: item.spaceName ?? item.ipAddress,
      time: item.timeLabel,
      tone: isShare ? "violet" : isTransfer ? "emerald" : "blue",
      icon: isShare ? <LinkIcon className="h-4 w-4" /> : isTransfer ? <UploadIcon className="h-4 w-4" /> : <HistoryIcon className="h-4 w-4" />,
    };
  });
}

function buildTransferRows(workspaceTransfers: ReturnType<typeof usePortalWorkspaceData>["workspace"]["transfers"], t: TFunction): TransferRow[] {
  return workspaceTransfers.slice(0, 5).map((transfer) => ({
    id: transfer.id,
    name: transfer.name,
    detail: `${portalTransferDirectionLabel(transfer.direction, t)} - ${transfer.spaceName} - ${transfer.startedLabel}`,
    status: transfer.status,
    statusLabel: portalTransferStatusLabel(transfer.status, t),
    progress: transfer.progress,
    tone: portalTransferStatusTone(transfer.status),
  }));
}

function StorageOverviewCard({
  usedBytes,
  quotaBytes,
  trendBaseline,
  referenceDate,
}: {
  usedBytes: number | null | undefined;
  quotaBytes: number | null | undefined;
  trendBaseline?: ManagerUsageTrendBaseline | null;
  referenceDate?: string | Date | null;
}) {
  const { t } = useI18n();
  const usagePercent = percent(usedBytes, quotaBytes);
  const storageTrendPoints = useMemo(
    () => buildWorkspaceStorageEvolutionPoints(usedBytes, trendBaseline, referenceDate),
    [referenceDate, trendBaseline, usedBytes]
  );
  const growthDelta = workspaceStorageGrowthDelta(usedBytes, trendBaseline);
  const growthToneClass =
    growthDelta == null || growthDelta === 0
      ? "text-[var(--ui-text-muted)]"
      : growthDelta > 0
        ? "text-emerald-600 dark:text-emerald-300"
        : "text-rose-600 dark:text-rose-300";
  const growthLabel = trendBaseline?.label
    ? t({ en: `Growth (${trendBaseline.label})`, fr: `Croissance (${trendBaseline.label})`, de: `Wachstum (${trendBaseline.label})` })
    : t({ en: "Growth", fr: "Croissance", de: "Wachstum" });
  const projectedFull = formatWorkspaceProjectedFull(usedBytes, quotaBytes, trendBaseline, {
    full: t({ en: "Full", fr: "Plein", de: "Voll" }),
    stable: t({ en: "Stable", fr: "Stable", de: "Stabil" }),
    days: (value) => t({ en: `~${value} days`, fr: `~${value} jours`, de: `~${value} Tage` }),
    months: (value) => t({ en: `~${value} months`, fr: `~${value} mois`, de: `~${value} Monate` }),
    years: (value) => t({ en: `~${value} years`, fr: `~${value} ans`, de: `~${value} Jahre` }),
  });
  return (
    <section className={cx(uiCardClass, "h-full p-4")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="ui-subtitle font-semibold text-[var(--ui-text)]">{t({ en: "Storage overview", fr: "Vue du stockage", de: "Speicherübersicht" })}</h2>
        <Link to="/portal/usage" className="inline-flex items-center gap-2 ui-caption font-semibold text-primary">
          {t({ en: "Usage analytics", fr: "Analyse d'utilisation", de: "Nutzungsanalyse" })}
          <OpenIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <p className={cx("ui-body", uiMutedTextClass)}>{t({ en: "Storage Used", fr: "Stockage utilisé", de: "Genutzter Speicher" })}</p>
          <p className="mt-1 text-[24px] font-semibold leading-7 text-[var(--ui-text)]">
            {formatBytes(usedBytes)}
            {quotaBytes != null && <span className="font-medium text-[var(--ui-text)]/75"> / {formatBytes(quotaBytes)}</span>}
          </p>
        </div>
        <p className="text-[20px] font-semibold leading-6 text-primary">{usagePercent == null ? "" : formatPercentage(usagePercent)}</p>
      </div>
      {usagePercent != null ? (
        <ProgressBar value={usagePercent} className="mt-3 h-2.5" ariaLabel={t({ en: "Portal storage quota usage", fr: "Utilisation du quota de stockage Portal", de: "Portal-Speicherquotennutzung" })} />
      ) : (
        <p className={cx("mt-3 ui-caption font-semibold", uiMutedTextClass)}>{t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar" })}</p>
      )}
      <WorkspaceDashboardStorageEvolutionChart
        points={storageTrendPoints}
        emptyLabel={t({ en: "Storage usage unavailable.", fr: "Utilisation du stockage indisponible.", de: "Speichernutzung nicht verfügbar." })}
        chartLabel={t({ en: "Storage evolution chart", fr: "Graphique d'évolution du stockage", de: "Diagramm zur Speicherentwicklung" })}
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="h-full">
          <div className="min-h-[55px] rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-1.5">
            <p className="text-[10px] font-semibold leading-4 text-[var(--ui-text-muted)]">{growthLabel}</p>
            <p className={cx("mt-1 text-base font-semibold leading-5", growthToneClass)}>
              {formatWorkspaceSignedBytesDelta(growthDelta)}
            </p>
          </div>
        </div>
        <div className="h-full">
          <div className="min-h-[55px] rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold leading-4 text-[var(--ui-text-muted)]">{t({ en: "Projected full", fr: "Saturation estimée", de: "Voraussichtlich voll" })}</p>
              <InfoIcon className="h-3.5 w-3.5 text-[var(--ui-text-muted)]" />
            </div>
            <p className="mt-1 text-base font-semibold leading-5 text-[var(--ui-text)]">{projectedFull}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function TopStorageSpacesCard({ rows }: { rows: StorageSpaceRow[] }) {
  const { t } = useI18n();
  return (
    <WorkspaceDashboardCard
      title={t({ en: "Top storage spaces", fr: "Principaux espaces de stockage", de: "Größte Speicherbereiche" })}
      action={
        <Link to="/portal/storage-spaces" className="inline-flex items-center gap-2 ui-caption font-semibold text-primary">
          {t({ en: "View all spaces", fr: "Voir tous les espaces", de: "Alle Bereiche anzeigen" })}
          <OpenIcon className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {rows.length === 0 ? (
        <WorkspaceDashboardEmptyState>{t({ en: "No Storage Spaces to display.", fr: "Aucun espace de stockage à afficher.", de: "Keine Speicherbereiche zum Anzeigen." })}</WorkspaceDashboardEmptyState>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(92px,0.8fr)_minmax(72px,0.5fr)] gap-3 text-[11px] font-semibold leading-4 text-[var(--ui-text-muted)]">
            <span>{t({ en: "Storage space", fr: "Espace de stockage", de: "Speicherbereich" })}</span>
            <span>{t({ en: "Storage", fr: "Stockage", de: "Speicher" })}</span>
            <span className="text-right">{t({ en: "Objects", fr: "Objets", de: "Objekte" })}</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid min-h-[44px] grid-cols-[minmax(0,1.2fr)_minmax(92px,0.8fr)_minmax(72px,0.5fr)] items-center gap-3"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <IconBubble tone="emerald" className="h-7 w-7 rounded-md">
                    <BucketIcon className="h-4 w-4" />
                  </IconBubble>
                  {row.space && !row.isOther ? (
                    <Link to={storageSpacePath(row.space)} className="truncate ui-caption font-semibold text-[var(--ui-text)] hover:text-primary">
                      {row.name}
                    </Link>
                  ) : (
                    <span className="truncate ui-caption font-semibold text-[var(--ui-text)]">{row.name}</span>
                  )}
                </div>
                {row.space && row.role && row.status ? (
                  <div className="mt-1 flex flex-wrap gap-1.5 pl-9">
                    <UiBadge tone={portalRoleTone(row.role)} className="rounded-md px-2 py-0 text-[11px] leading-5">
                      {portalRoleLabel(row.role, t)}
                    </UiBadge>
                    <UiBadge tone={portalStorageSpaceStatusTone(row.space)} className="rounded-md px-2 py-0 text-[11px] leading-5">
                      {portalStatusLabel(row.status, t)}
                    </UiBadge>
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3">
                <span className="ui-caption font-semibold text-[var(--ui-text)]">{formatBytes(row.usedBytes)}</span>
                {row.percent != null ? <ProgressBar value={row.percent} className="h-1.5" /> : <span className="h-1.5" />}
              </div>
              <span className="text-right ui-caption font-semibold text-[var(--ui-text)]">{formatDashboardNumber(row.objectCount)}</span>
            </div>
          ))}
        </div>
      )}
    </WorkspaceDashboardCard>
  );
}

function RecentTransfersCard({ rows }: { rows: TransferRow[] }) {
  const { t } = useI18n();
  return (
    <WorkspaceDashboardCard
      title={t({ en: "Recent transfers", fr: "Transferts récents", de: "Letzte Transfers" })}
      action={<Link to="/portal/transfers" className="ui-caption font-semibold text-primary">{t({ en: "View all", fr: "Tout voir", de: "Alle anzeigen" })}</Link>}
    >
      {rows.length === 0 ? (
        <WorkspaceDashboardEmptyState>{t({ en: "No recent transfers.", fr: "Aucun transfert récent.", de: "Keine letzten Transfers." })}</WorkspaceDashboardEmptyState>
      ) : (
        <div className="space-y-2">
          {rows.map((transfer) => (
            <div key={transfer.id} className="rounded-md border border-[color:var(--ui-border-soft)] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate ui-caption font-semibold text-[var(--ui-text)]">{transfer.name}</p>
                  <p className={cx("mt-0.5 truncate ui-caption", uiMutedTextClass)}>{transfer.detail}</p>
                </div>
                <UiBadge tone={transfer.tone} className="rounded-md px-2 py-0 text-[11px] leading-5">
                  {transfer.statusLabel}
                </UiBadge>
              </div>
              {transfer.status === "Uploading" || transfer.status === "Queued" ? (
                <ProgressBar value={transfer.progress} tone="blue" className="mt-2 h-1.5" />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </WorkspaceDashboardCard>
  );
}

function RecentActivityCard({ rows }: { rows: ActivityRow[] }) {
  const { t } = useI18n();
  return (
    <WorkspaceDashboardCard
      title={t({ en: "Recent activity", fr: "Activité récente", de: "Letzte Aktivität" })}
      action={<Link to="/portal/activity" className="ui-caption font-semibold text-primary">{t({ en: "View all", fr: "Tout voir", de: "Alle anzeigen" })}</Link>}
    >
      {rows.length === 0 ? (
        <WorkspaceDashboardEmptyState>{t({ en: "No recent activity.", fr: "Aucune activité récente.", de: "Keine letzte Aktivität." })}</WorkspaceDashboardEmptyState>
      ) : (
        <div className="space-y-2">
          {rows.map((activity) => (
            <div key={activity.id} className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <IconBubble tone={activity.tone} className="h-7 w-7 rounded-md">
                  {activity.icon}
                </IconBubble>
                <div className="min-w-0">
                  <p className="truncate ui-caption font-semibold text-[var(--ui-text)]">{activity.label}</p>
                  <p className={cx("mt-0.5 truncate ui-caption", uiMutedTextClass)}>{activity.detail}</p>
                </div>
              </div>
              <span className={cx("shrink-0 ui-caption", uiMutedTextClass)}>{activity.time}</span>
            </div>
          ))}
        </div>
      )}
    </WorkspaceDashboardCard>
  );
}

function AlertsCard({
  alerts,
  healthStatus,
}: {
  alerts: ReturnType<typeof usePortalWorkspaceData>["workspace"]["alerts"];
  healthStatus: HealthCheckStatus;
}) {
  const { t } = useI18n();
  return (
    <WorkspaceDashboardCard title={t({ en: "Alerts & service status", fr: "Alertes et statut du service", de: "Warnungen und Dienststatus" })}>
      <div className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 ui-caption font-semibold text-[var(--ui-text)]">
            <WorkspaceStatusDot status={healthStatus} />
            <span className="truncate">{workspaceHealthLabel(healthStatus, t)}</span>
          </p>
          <UiBadge
            tone={healthStatus === "up" ? "success" : healthStatus === "down" ? "danger" : healthStatus === "degraded" ? "warning" : "neutral"}
            className="rounded-md px-2 py-0 text-[11px] leading-5"
          >
            {healthStatus === "up"
              ? t({ en: "Operational", fr: "Opérationnel", de: "Betriebsbereit" })
              : healthStatus === "degraded"
                ? t({ en: "Degraded", fr: "Dégradé", de: "Beeinträchtigt" })
                : healthStatus === "down"
                  ? t({ en: "Issue", fr: "Incident", de: "Problem" })
                  : t({ en: "Unknown", fr: "Inconnu", de: "Unbekannt" })}
          </UiBadge>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {alerts.length === 0 ? (
          <WorkspaceDashboardEmptyState>{t({ en: "No alerts to display.", fr: "Aucune alerte à afficher.", de: "Keine Warnungen zum Anzeigen." })}</WorkspaceDashboardEmptyState>
        ) : (
          alerts.slice(0, 4).map((alert) => (
            <div key={alert.id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--ui-border-soft)] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate ui-caption font-semibold text-[var(--ui-text)]">{alert.title}</p>
                <p className={cx("mt-0.5 truncate ui-caption", uiMutedTextClass)}>{alert.description}</p>
              </div>
              <UiBadge tone={alertTone(alert.tone)} className="rounded-md px-2 py-0 text-[11px] leading-5">
                {alert.severityLabel ?? t({ en: "Info", fr: "Info", de: "Info" })}
              </UiBadge>
            </div>
          ))
        )}
      </div>
    </WorkspaceDashboardCard>
  );
}

function QuickLinksCard({ links }: { links: QuickLink[] }) {
  const { t } = useI18n();
  return (
    <WorkspaceDashboardCard title={t({ en: "Quick links", fr: "Raccourcis", de: "Schnellzugriffe" })}>
      <div className="grid gap-2">
        {links.map((link) => (
          <Link
            key={link.label}
            to={link.to}
            className="flex min-h-[48px] items-center justify-between gap-3 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 transition hover:border-primary hover:bg-[var(--ui-hover)]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <IconBubble tone={link.tone} className="h-7 w-7 rounded-md">
                {link.icon}
              </IconBubble>
              <span className="min-w-0">
                <span className="block truncate ui-caption font-semibold text-[var(--ui-text)]">{link.label}</span>
                <span className={cx("block truncate ui-caption", uiMutedTextClass)}>{link.detail}</span>
              </span>
            </span>
            <OpenIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ui-text-muted)]" />
          </Link>
        ))}
      </div>
    </WorkspaceDashboardCard>
  );
}

function ProjectAccountsCard({
  project,
  accounts,
}: {
  project: ReturnType<typeof usePortalWorkspaceData>["selectedProject"];
  accounts: ReturnType<typeof usePortalWorkspaceData>["selectedProjectAccounts"];
}) {
  const { t } = useI18n();
  const visibleAccounts = accounts.slice(0, 4);
  return (
    <WorkspaceDashboardCard title={t({ en: "Storage locations", fr: "Localisations de stockage", de: "Speicherstandorte" })}>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <IconBubble tone="blue">
            <InfoIcon className="h-4 w-4" />
          </IconBubble>
          <div className="min-w-0">
            <p className={cx("truncate text-sm font-bold", uiTitleTextClass)}>{project?.name ?? "-"}</p>
            <p className={cx("text-xs", uiMutedTextClass)}>
              {t({ en: `${accounts.length} available location(s)`, fr: `${accounts.length} localisation(s) disponible(s)`, de: `${accounts.length} verfügbare Speicherstandorte` })}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {visibleAccounts.map((account) => (
            <div key={account.account_id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--ui-border-soft)] px-3 py-2">
              <div className="min-w-0">
                <p className={cx("truncate text-xs font-bold", uiTitleTextClass)}>{account.display_name}</p>
                <p className={cx("truncate text-[11px]", uiMutedTextClass)}>{account.storage_endpoint_name ?? account.account_name}</p>
              </div>
              {account.storage_endpoint_zonegroup ? <UiBadge tone="primary">{account.storage_endpoint_zonegroup}</UiBadge> : null}
            </div>
          ))}
          {accounts.length > visibleAccounts.length ? (
            <p className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
              {t({ en: `+${accounts.length - visibleAccounts.length} more`, fr: `+${accounts.length - visibleAccounts.length} autre(s)`, de: `+${accounts.length - visibleAccounts.length} weitere` })}
            </p>
          ) : null}
        </div>
      </div>
    </WorkspaceDashboardCard>
  );
}

export default function PortalDashboard() {
  const { t } = useI18n();
  const {
    workspace,
    health,
    healthAlerts,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    traffic,
    trafficByWindow,
    usageTrends,
    trafficLoading,
    trafficError,
    usage,
    selectedProject,
    selectedProjectAccounts,
  } = usePortalWorkspaceData({
    includeTraffic: true,
    includeTrafficTrend: true,
    includeHealth: true,
    includeUsageTrends: true,
  });

  const storageRows = useMemo(() => buildStorageRows(workspace.spaces, usage?.other_storage_space), [usage?.other_storage_space, workspace.spaces]);
  const activityRows = useMemo(() => buildActivityRows(workspace.activity, t), [t, workspace.activity]);
  const transferRows = useMemo(() => buildTransferRows(workspace.transfers, t), [t, workspace.transfers]);
  const currentTraffic = trafficByWindow.day ?? traffic;
  const trafficTrend = useMemo(() => {
    const selection = selectWorkspaceTrafficTrend(trafficByWindow);
    return selection ? { ...selection, label: portalTrendPeriodLabel(selection.label, t) } : null;
  }, [t, trafficByWindow]);
  const storageTrendBaseline = useMemo(() => localizeTrendBaseline(usageTrends?.storage ?? null, t), [t, usageTrends?.storage]);
  const bucketsTrendBaseline = useMemo(() => localizeTrendBaseline(usageTrends?.buckets ?? null, t), [t, usageTrends?.buckets]);
  const objectsTrendBaseline = useMemo(() => localizeTrendBaseline(usageTrends?.objects ?? null, t), [t, usageTrends?.objects]);
  const healthStatus = workspaceHealthStatus(health);
  const alerts = (workspace.alerts.length > 0 ? workspace.alerts : healthAlerts).slice(0, 4);
  const activeSpaces = workspace.spaces.filter((space) => space.status !== "Archived").length;
  const transferBytes = currentTraffic ? workspaceTrafficTotalBytes(currentTraffic) : null;
  const quotaOfLabel = t({ en: "of", fr: "sur", de: "von" });
  const trendComparisonLabel = t({ en: "vs", fr: "par rapport à", de: "gegenüber" });
  const metrics = buildWorkspaceDashboardKpis({
    storage: {
      label: t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher" }),
      usedBytes: workspace.usedBytes,
      quotaBytes: workspace.quotaBytes,
      quotaUnavailableDetail: t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar" }),
      progressLabel: t({ en: "Portal storage quota usage", fr: "Utilisation du quota de stockage Portal", de: "Portal-Speicherquotennutzung" }),
      trendBaseline: storageTrendBaseline,
      quotaOfLabel,
      trendComparisonLabel,
      icon: <BucketIcon className="h-7 w-7" />,
      to: "/portal/usage",
    },
    spaces: {
      label: t({ en: "Storage spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }),
      value: workspace.spaces.length,
      quota: workspace.maxBuckets,
      unitLabel: t({ en: "spaces", fr: "espaces", de: "Bereiche" }),
      activeValue: activeSpaces,
      activeLabel: t({ en: "active", fr: "actifs", de: "aktiv" }),
      progressLabel: t({ en: "Storage spaces quota usage", fr: "Utilisation du quota d'espaces de stockage", de: "Speicherbereich-Quotennutzung" }),
      trendBaseline: bucketsTrendBaseline,
      trendBaselineValue: bucketsTrendBaseline?.bucket_count,
      quotaOfLabel,
      trendComparisonLabel,
      tone: "emerald",
      icon: <BucketCollectionIcon className="h-7 w-7" />,
      to: "/portal/storage-spaces",
    },
    objects: {
      label: t({ en: "Objects", fr: "Objets", de: "Objekte" }),
      value: workspace.usedObjects,
      quota: workspace.quotaObjects,
      unitLabel: t({ en: "objects", fr: "objets", de: "Objekte" }),
      knownDetail: t({ en: "Tracked objects", fr: "Objets suivis", de: "Erfasste Objekte" }),
      progressLabel: t({ en: "Portal object quota usage", fr: "Utilisation du quota d'objets Portal", de: "Portal-Objektquotennutzung" }),
      trendBaseline: objectsTrendBaseline,
      trendBaselineValue: objectsTrendBaseline?.used_objects,
      quotaOfLabel,
      trendComparisonLabel,
      tone: "violet",
      icon: <FileIcon className="h-7 w-7" />,
      to: "/portal/usage",
    },
    transfer: {
      label: t({ en: "Transfer", fr: "Transfert", de: "Transfer" }),
      bytes: transferBytes,
      loading: trafficLoading,
      trendSelection: trafficError ? null : trafficTrend,
      detailLabel: t({ en: "Last 24h", fr: "Dernières 24 h", de: "Letzte 24 Std." }),
      trendComparisonLabel,
      icon: <TransferIcon className="h-7 w-7" />,
      to: "/portal/usage",
      unavailableReason: trafficError,
    },
  });
  const quickLinks: QuickLink[] = [
    {
      label: t({ en: "Storage spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }),
      detail: t({ en: "Open workspace storage", fr: "Ouvrir le stockage du workspace", de: "Arbeitsbereichspeicher öffnen" }),
      to: "/portal/storage-spaces",
      tone: "emerald",
      icon: <BucketCollectionIcon className="h-4 w-4" />,
    },
    {
      label: t({ en: "Shares", fr: "Partages", de: "Freigaben" }),
      detail: t({ en: "Review shared access", fr: "Voir les accès partagés", de: "Freigegebene Zugriffe prüfen" }),
      to: "/portal/shares",
      tone: "violet",
      icon: <LinkIcon className="h-4 w-4" />,
    },
    {
      label: t({ en: "Transfers", fr: "Transferts", de: "Transfers" }),
      detail: t({ en: "Track uploads and downloads", fr: "Suivre les envois et téléchargements", de: "Uploads und Downloads verfolgen" }),
      to: "/portal/transfers",
      tone: "amber",
      icon: <TransferIcon className="h-4 w-4" />,
    },
    {
      label: t({ en: "Usage analytics", fr: "Analyse d'utilisation", de: "Nutzungsanalyse" }),
      detail: t({ en: "Inspect usage and traffic", fr: "Consulter l'utilisation et le trafic", de: "Nutzung und Traffic prüfen" }),
      to: "/portal/usage",
      tone: "blue",
      icon: <HistoryIcon className="h-4 w-4" />,
    },
  ];

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading dashboard...", fr: "Chargement du tableau de bord...", de: "Dashboard wird geladen..." }),
    noAccountMessage: t({ en: "Select an account to open the dashboard.", fr: "Sélectionnez un compte pour ouvrir le tableau de bord.", de: "Wählen Sie ein Konto aus, um das Dashboard zu öffnen." }),
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-3" data-testid="portal-dashboard">
      <PageHeader
        title={t({ en: "Portal dashboard", fr: "Tableau de bord Portal", de: "Portal-Dashboard" })}
        description={t({ en: `Workspace overview for ${workspace.accountName}.`, fr: `Vue du workspace ${workspace.accountName}.`, de: `Arbeitsbereichsübersicht für ${workspace.accountName}.` })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Dashboard", fr: "Tableau de bord", de: "Dashboard" }) })}
        rightContent={
          <div className="flex h-8 items-center gap-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 text-xs font-semibold text-[var(--ui-text-muted)]">
            <span>{t({ en: "Current period", fr: "Période en cours", de: "Aktueller Zeitraum" })}</span>
          </div>
        }
      />

      <KpiRow metrics={metrics} />

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-4">
          <StorageOverviewCard
            usedBytes={workspace.usedBytes}
            quotaBytes={workspace.quotaBytes}
            trendBaseline={storageTrendBaseline}
            referenceDate={currentTraffic?.end}
          />
        </div>
        <div className="min-w-0 xl:col-span-8">
          <TopStorageSpacesCard rows={storageRows} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-5">
        <RecentTransfersCard rows={transferRows} />
        <RecentActivityCard rows={activityRows} />
        <AlertsCard alerts={alerts} healthStatus={healthStatus} />
        <ProjectAccountsCard project={selectedProject} accounts={selectedProjectAccounts} />
        <QuickLinksCard links={quickLinks} />
      </div>
    </div>
  );
}

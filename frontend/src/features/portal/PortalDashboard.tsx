/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { HealthCheckStatus } from "../../api/healthchecks";
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
  type WorkspaceDashboardStorageEvolutionPoint,
  type WorkspaceDashboardTone,
} from "../../components/WorkspaceDashboardKit";
import {
  buildWorkspaceDashboardKpis,
  selectWorkspaceTrafficTrend,
  workspaceTrafficTotalBytes,
} from "../../components/workspaceDashboardKpis";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import UiBadge from "../../components/ui/UiBadge";
import { cx, uiCardClass, uiMutedTextClass } from "../../components/ui/styles";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import {
  BucketCollectionIcon,
  BucketIcon,
  FileIcon,
  HistoryIcon,
  LinkIcon,
  OpenIcon,
  TransferIcon,
  UploadIcon,
} from "../browser/browserIcons";
import { storageSpacePath, type PortalWorkspaceSpace } from "./portalWorkspaceModel";
import {
  portalRoleTone,
  portalStorageSpaceStatusTone,
  portalTransferStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type StorageSpaceRow = {
  space: PortalWorkspaceSpace;
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
  status: string;
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

function workspaceHealthLabel(status: HealthCheckStatus): string {
  if (status === "up") return "Storage services operational";
  if (status === "degraded") return "Storage services degraded";
  if (status === "down") return "Storage service availability issue";
  return "Storage service status unavailable";
}

function buildStorageRows(spaces: PortalWorkspaceSpace[]): StorageSpaceRow[] {
  const rows = [...spaces]
    .sort((left, right) => (right.usedBytes ?? 0) - (left.usedBytes ?? 0))
    .slice(0, TOP_STORAGE_SPACES_LIMIT);
  const maxBytes = Math.max(...rows.map((row) => row.usedBytes ?? 0), 1);
  return rows.map((space) => {
    const quotaPercent = percent(space.usedBytes, space.quotaBytes);
    const rankingPercent = space.usedBytes == null ? null : Math.max(4, ((space.usedBytes ?? 0) / maxBytes) * 100);
    return { space, percent: quotaPercent ?? rankingPercent };
  });
}

function buildActivityRows(workspaceActivity: ReturnType<typeof usePortalWorkspaceData>["workspace"]["activity"]): ActivityRow[] {
  return workspaceActivity.slice(0, 5).map((item) => {
    const action = item.action.toLowerCase();
    const isShare = action.includes("share");
    const isTransfer = action.includes("upload") || action.includes("download");
    return {
      id: item.id,
      label: `${item.actor} ${action} ${item.target}`,
      detail: item.spaceName ?? item.ipAddress,
      time: item.timeLabel,
      tone: isShare ? "violet" : isTransfer ? "emerald" : "blue",
      icon: isShare ? <LinkIcon className="h-4 w-4" /> : isTransfer ? <UploadIcon className="h-4 w-4" /> : <HistoryIcon className="h-4 w-4" />,
    };
  });
}

function buildTransferRows(workspaceTransfers: ReturnType<typeof usePortalWorkspaceData>["workspace"]["transfers"]): TransferRow[] {
  return workspaceTransfers.slice(0, 5).map((transfer) => ({
    id: transfer.id,
    name: transfer.name,
    detail: `${transfer.direction} - ${transfer.spaceName} - ${transfer.startedLabel}`,
    status: transfer.status,
    progress: transfer.progress,
    tone: portalTransferStatusTone(transfer.status),
  }));
}

function StorageOverviewCard({
  usedBytes,
  quotaBytes,
  objectCount,
  dataInBytes,
  dataOutBytes,
  storageTrendPoints,
}: {
  usedBytes: number | null | undefined;
  quotaBytes: number | null | undefined;
  objectCount: number | null | undefined;
  dataInBytes: number | null | undefined;
  dataOutBytes: number | null | undefined;
  storageTrendPoints: WorkspaceDashboardStorageEvolutionPoint[];
}) {
  const usagePercent = percent(usedBytes, quotaBytes);
  return (
    <section className={cx(uiCardClass, "h-full p-4")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="ui-subtitle font-semibold text-[var(--ui-text)]">Storage overview</h2>
        <Link to="/portal/usage" className="inline-flex items-center gap-2 ui-caption font-semibold text-primary">
          Usage analytics
          <OpenIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <p className={cx("ui-body", uiMutedTextClass)}>Storage Used</p>
          <p className="mt-1 text-[24px] font-semibold leading-7 text-[var(--ui-text)]">
            {formatBytes(usedBytes)}
            {quotaBytes != null && <span className="font-medium text-[var(--ui-text)]/75"> / {formatBytes(quotaBytes)}</span>}
          </p>
        </div>
        <p className="text-[20px] font-semibold leading-6 text-primary">{usagePercent == null ? "" : formatPercentage(usagePercent)}</p>
      </div>
      {usagePercent != null ? (
        <ProgressBar value={usagePercent} className="mt-3 h-2.5" ariaLabel="Portal storage quota usage" />
      ) : (
        <p className={cx("mt-3 ui-caption font-semibold", uiMutedTextClass)}>Quota unavailable</p>
      )}
      <WorkspaceDashboardStorageEvolutionChart points={storageTrendPoints} emptyLabel="Storage usage unavailable." />
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="min-h-[55px] rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-1.5">
          <p className="text-[10px] font-semibold leading-4 text-[var(--ui-text-muted)]">Objects</p>
          <p className="mt-1 text-base font-semibold leading-5 text-[var(--ui-text)]">{formatDashboardNumber(objectCount)}</p>
        </div>
        <div className="min-h-[55px] rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-1.5">
          <p className="text-[10px] font-semibold leading-4 text-[var(--ui-text-muted)]">Data in</p>
          <p className="mt-1 text-base font-semibold leading-5 text-[var(--ui-text)]">{formatBytes(dataInBytes)}</p>
        </div>
        <div className="min-h-[55px] rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-1.5">
          <p className="text-[10px] font-semibold leading-4 text-[var(--ui-text-muted)]">Data out</p>
          <p className="mt-1 text-base font-semibold leading-5 text-[var(--ui-text)]">{formatBytes(dataOutBytes)}</p>
        </div>
      </div>
    </section>
  );
}

function TopStorageSpacesCard({ rows }: { rows: StorageSpaceRow[] }) {
  return (
    <WorkspaceDashboardCard
      title="Top storage spaces"
      action={
        <Link to="/portal/storage-spaces" className="inline-flex items-center gap-2 ui-caption font-semibold text-primary">
          View all spaces
          <OpenIcon className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {rows.length === 0 ? (
        <WorkspaceDashboardEmptyState>No Storage Spaces to display.</WorkspaceDashboardEmptyState>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(92px,0.8fr)_minmax(72px,0.5fr)] gap-3 text-[11px] font-semibold leading-4 text-[var(--ui-text-muted)]">
            <span>Storage space</span>
            <span>Storage</span>
            <span className="text-right">Objects</span>
          </div>
          {rows.map(({ space, percent: rowPercent }) => (
            <div
              key={space.id}
              className="grid min-h-[44px] grid-cols-[minmax(0,1.2fr)_minmax(92px,0.8fr)_minmax(72px,0.5fr)] items-center gap-3"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <IconBubble tone="emerald" className="h-7 w-7 rounded-md">
                    <BucketIcon className="h-4 w-4" />
                  </IconBubble>
                  <Link to={storageSpacePath(space)} className="truncate ui-caption font-semibold text-[var(--ui-text)] hover:text-primary">
                    {space.name}
                  </Link>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 pl-9">
                  <UiBadge tone={portalRoleTone(space.role)} className="rounded-md px-2 py-0 text-[11px] leading-5">
                    {space.role}
                  </UiBadge>
                  <UiBadge tone={portalStorageSpaceStatusTone(space)} className="rounded-md px-2 py-0 text-[11px] leading-5">
                    {space.status}
                  </UiBadge>
                </div>
              </div>
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3">
                <span className="ui-caption font-semibold text-[var(--ui-text)]">{formatBytes(space.usedBytes)}</span>
                {rowPercent != null ? <ProgressBar value={rowPercent} className="h-1.5" /> : <span className="h-1.5" />}
              </div>
              <span className="text-right ui-caption font-semibold text-[var(--ui-text)]">{formatDashboardNumber(space.objectCount)}</span>
            </div>
          ))}
        </div>
      )}
    </WorkspaceDashboardCard>
  );
}

function RecentTransfersCard({ rows }: { rows: TransferRow[] }) {
  return (
    <WorkspaceDashboardCard
      title="Recent transfers"
      action={<Link to="/portal/transfers" className="ui-caption font-semibold text-primary">View all</Link>}
    >
      {rows.length === 0 ? (
        <WorkspaceDashboardEmptyState>No recent transfers.</WorkspaceDashboardEmptyState>
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
                  {transfer.status}
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
  return (
    <WorkspaceDashboardCard
      title="Recent activity"
      action={<Link to="/portal/activity" className="ui-caption font-semibold text-primary">View all</Link>}
    >
      {rows.length === 0 ? (
        <WorkspaceDashboardEmptyState>No recent activity.</WorkspaceDashboardEmptyState>
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
  return (
    <WorkspaceDashboardCard title="Alerts & service status">
      <div className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 ui-caption font-semibold text-[var(--ui-text)]">
            <WorkspaceStatusDot status={healthStatus} />
            <span className="truncate">{workspaceHealthLabel(healthStatus)}</span>
          </p>
          <UiBadge
            tone={healthStatus === "up" ? "success" : healthStatus === "down" ? "danger" : healthStatus === "degraded" ? "warning" : "neutral"}
            className="rounded-md px-2 py-0 text-[11px] leading-5"
          >
            {healthStatus === "up" ? "Operational" : healthStatus === "degraded" ? "Degraded" : healthStatus === "down" ? "Issue" : "Unknown"}
          </UiBadge>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {alerts.length === 0 ? (
          <WorkspaceDashboardEmptyState>No alerts to display.</WorkspaceDashboardEmptyState>
        ) : (
          alerts.slice(0, 4).map((alert) => (
            <div key={alert.id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--ui-border-soft)] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate ui-caption font-semibold text-[var(--ui-text)]">{alert.title}</p>
                <p className={cx("mt-0.5 truncate ui-caption", uiMutedTextClass)}>{alert.description}</p>
              </div>
              <UiBadge tone={alertTone(alert.tone)} className="rounded-md px-2 py-0 text-[11px] leading-5">
                {alert.severityLabel ?? "Info"}
              </UiBadge>
            </div>
          ))
        )}
      </div>
    </WorkspaceDashboardCard>
  );
}

function QuickLinksCard({ links }: { links: QuickLink[] }) {
  return (
    <WorkspaceDashboardCard title="Quick links">
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

export default function PortalDashboard() {
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
  } = usePortalWorkspaceData({
    includeTraffic: true,
    includeTrafficTrend: true,
    includeHealth: true,
    includeUsageTrends: true,
  });

  const storageRows = useMemo(() => buildStorageRows(workspace.spaces), [workspace.spaces]);
  const activityRows = useMemo(() => buildActivityRows(workspace.activity), [workspace.activity]);
  const transferRows = useMemo(() => buildTransferRows(workspace.transfers), [workspace.transfers]);
  const currentTraffic = trafficByWindow.day ?? traffic;
  const dataInBytes = currentTraffic?.totals.bytes_in ?? null;
  const dataOutBytes = currentTraffic?.totals.bytes_out ?? null;
  const storageTrendPoints = useMemo(
    () => buildWorkspaceStorageEvolutionPoints(workspace.usedBytes, usageTrends?.storage, currentTraffic?.end),
    [currentTraffic?.end, usageTrends?.storage, workspace.usedBytes]
  );
  const trafficTrend = useMemo(() => selectWorkspaceTrafficTrend(trafficByWindow), [trafficByWindow]);
  const healthStatus = workspaceHealthStatus(health);
  const alerts = (workspace.alerts.length > 0 ? workspace.alerts : healthAlerts).slice(0, 4);
  const activeSpaces = workspace.spaces.filter((space) => space.status !== "Archived").length;
  const transferBytes = currentTraffic ? workspaceTrafficTotalBytes(currentTraffic) : null;
  const metrics = buildWorkspaceDashboardKpis({
    storage: {
      usedBytes: workspace.usedBytes,
      quotaBytes: workspace.quotaBytes,
      quotaUnavailableDetail: "Quota unavailable",
      progressLabel: "Portal storage quota usage",
      trendBaseline: usageTrends?.storage,
      icon: <BucketIcon className="h-7 w-7" />,
      to: "/portal/usage",
    },
    spaces: {
      label: "Storage spaces",
      value: workspace.spaces.length,
      quota: workspace.maxBuckets,
      unitLabel: "spaces",
      activeValue: activeSpaces,
      activeLabel: "active",
      progressLabel: "Storage spaces quota usage",
      trendBaseline: usageTrends?.buckets,
      trendBaselineValue: usageTrends?.buckets?.bucket_count,
      tone: "emerald",
      icon: <BucketCollectionIcon className="h-7 w-7" />,
      to: "/portal/storage-spaces",
    },
    objects: {
      label: "Objects",
      value: workspace.usedObjects,
      quota: workspace.quotaObjects,
      unitLabel: "objects",
      knownDetail: "Tracked objects",
      progressLabel: "Portal object quota usage",
      trendBaseline: usageTrends?.objects,
      trendBaselineValue: usageTrends?.objects?.used_objects,
      tone: "violet",
      icon: <FileIcon className="h-7 w-7" />,
      to: "/portal/usage",
    },
    transfer: {
      bytes: transferBytes,
      loading: trafficLoading,
      trendSelection: trafficError ? null : trafficTrend,
      icon: <TransferIcon className="h-7 w-7" />,
      to: "/portal/usage",
      unavailableReason: trafficError,
    },
  });
  const quickLinks: QuickLink[] = [
    {
      label: "Storage spaces",
      detail: "Open workspace storage",
      to: "/portal/storage-spaces",
      tone: "emerald",
      icon: <BucketCollectionIcon className="h-4 w-4" />,
    },
    {
      label: "Shares",
      detail: "Review shared access",
      to: "/portal/shares",
      tone: "violet",
      icon: <LinkIcon className="h-4 w-4" />,
    },
    {
      label: "Transfers",
      detail: "Track uploads and downloads",
      to: "/portal/transfers",
      tone: "amber",
      icon: <TransferIcon className="h-4 w-4" />,
    },
    {
      label: "Usage analytics",
      detail: "Inspect usage and traffic",
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
    loadingMessage: "Loading dashboard...",
    noAccountMessage: "Select an account to open the dashboard.",
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-3" data-testid="portal-dashboard">
      <PageHeader
        title="Portal dashboard"
        description={`Workspace overview for ${workspace.accountName}.`}
        breadcrumbs={portalBreadcrumbs({ label: "Dashboard" })}
        rightContent={
          <div className="flex h-8 items-center gap-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 text-xs font-semibold text-[var(--ui-text-muted)]">
            <span>Current period</span>
          </div>
        }
      />

      <KpiRow metrics={metrics} />

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-4">
          <StorageOverviewCard
            usedBytes={workspace.usedBytes}
            quotaBytes={workspace.quotaBytes}
            objectCount={workspace.usedObjects}
            dataInBytes={dataInBytes}
            dataOutBytes={dataOutBytes}
            storageTrendPoints={storageTrendPoints}
          />
        </div>
        <div className="min-w-0 xl:col-span-8">
          <TopStorageSpacesCard rows={storageRows} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
        <RecentTransfersCard rows={transferRows} />
        <RecentActivityCard rows={activityRows} />
        <AlertsCard alerts={alerts} healthStatus={healthStatus} />
        <QuickLinksCard links={quickLinks} />
      </div>
    </div>
  );
}

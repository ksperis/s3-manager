/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import DonutChart from "../../components/DonutChart";
import MiniLineChart from "../../components/MiniLineChart";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import StatCards from "../../components/StatCards";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import { storageSpacePath } from "./portalWorkspaceModel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const DONUT_COLORS = ["#2563eb", "#14b8a6", "#64748b", "#f59e0b", "#ef4444", "#94a3b8"];

function percent(used?: number | null, quota?: number | null): number {
  if (used == null || quota == null || quota <= 0) return 0;
  return Math.min(100, Math.max(0, (used / quota) * 100));
}

function alertTone(tone: string) {
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  if (tone === "info") return "primary";
  return "neutral";
}

function transferTone(status: string) {
  if (status === "Failed") return "danger";
  if (status === "Uploading" || status === "Queued") return "primary";
  return "neutral";
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-4 text-xs font-semibold text-slate-500">
      {children}
    </div>
  );
}

export default function PortalDashboard() {
  const { workspace, healthAlerts, loading, error, hasAccountContext, accountError, accountLoading, traffic, trafficLoading } =
    usePortalWorkspaceData({ includeTraffic: true, includeHealth: true });
  const alerts = (workspace.alerts.length > 0 ? workspace.alerts : healthAlerts).slice(0, 4);
  const topSpaces = [...workspace.spaces].sort((left, right) => (right.usedBytes ?? 0) - (left.usedBytes ?? 0)).slice(0, 5);
  const donutSegments = topSpaces.map((space, index) => ({
    value: space.usedBytes ?? 0,
    color: DONUT_COLORS[index] ?? "#94a3b8",
  }));
  const trendValues =
    (traffic?.series ?? []).length > 0
      ? (traffic?.series ?? []).map((point) => point.bytes_in + point.bytes_out)
      : workspace.usageTrend.map((point) => point.value);
  const trendLabels = (traffic?.series ?? []).map((point) =>
    new Date(point.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  );

  if (accountLoading || loading) {
    return (
      <div className="space-y-4">
        <PageBanner tone="info">Loading dashboard...</PageBanner>
      </div>
    );
  }

  if (accountError || error) {
    return (
      <div className="space-y-4">
        <PageBanner tone="error">{accountError ?? error}</PageBanner>
      </div>
    );
  }

  if (!hasAccountContext) {
    return (
      <div className="space-y-4">
        <PageBanner tone="info">Select an account to open the dashboard.</PageBanner>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${workspace.accountName}`}
        breadcrumbs={[{ label: "Portal" }, { label: "Dashboard" }]}
        right={
          <div className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm">
            <span>Current period</span>
          </div>
        }
      />

      <StatCards
        columns={4}
        stats={[
          {
            label: "Total Storage",
            value: formatBytes(workspace.usedBytes),
            hint: workspace.quotaBytes ? `${formatPercentage(percent(workspace.usedBytes, workspace.quotaBytes))} used` : "Quota unavailable",
          },
          { label: "Total Objects", value: formatCompactNumber(workspace.usedObjects), hint: workspace.usedObjects == null ? "Unavailable" : "Tracked" },
          { label: "Requests", value: formatCompactNumber(workspace.requestCount), hint: trafficLoading ? "Loading traffic" : workspace.requestCount == null ? "Unavailable" : "From traffic" },
          { label: "Data Out", value: formatBytes(workspace.dataOutBytes), hint: trafficLoading ? "Loading traffic" : workspace.dataOutBytes == null ? "Unavailable" : "From traffic" },
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-2">
        <UiCard title="Storage usage">
          {topSpaces.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-center">
              <DonutChart segments={donutSegments} center={formatBytes(workspace.usedBytes)} caption={workspace.quotaBytes ? `of ${formatBytes(workspace.quotaBytes)} used` : "quota unavailable"} />
              <div className="space-y-3">
                {topSpaces.map((space, index) => (
                  <div key={space.id} className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: DONUT_COLORS[index] ?? "#94a3b8" }} />
                      <span className="truncate font-semibold text-slate-700">{space.name}</span>
                    </div>
                    <span className="shrink-0 text-slate-500">{formatBytes(space.usedBytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState>No Storage Space usage available.</EmptyState>
          )}
        </UiCard>

        <UiCard title="Usage over time">
          {trendValues.length > 0 ? (
            <>
              <MiniLineChart values={trendValues} />
              <div className="mt-2 flex justify-between text-[11px] font-semibold text-slate-400">
                {(trendLabels.length > 0 ? trendLabels : workspace.usageTrend.map((point) => point.label)).map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </>
          ) : (
            <EmptyState>No usage trend available.</EmptyState>
          )}
          {trafficLoading ? <div className="mt-2 text-[11px] text-slate-400">Loading live trend...</div> : null}
        </UiCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <UiCard title="Top storage spaces">
          <div className="space-y-3">
            {topSpaces.map((space) => (
              <div key={space.id} className="grid grid-cols-[1fr_auto] gap-3">
                <Link to={storageSpacePath(space)} className="text-xs font-semibold">{space.name}</Link>
                <span className="text-xs font-semibold text-slate-500">{formatBytes(space.usedBytes)}</span>
                <div className="col-span-2">
                  <UiProgressBar value={percent(space.usedBytes, workspace.usedBytes)} />
                </div>
              </div>
            ))}
            {topSpaces.length === 0 ? <EmptyState>No Storage Spaces to display.</EmptyState> : null}
          </div>
        </UiCard>

        <UiCard title="Recent activity" actions={<Link to="/portal/activity" className="ui-caption font-semibold">View all activity</Link>}>
          <div className="space-y-2">
            {workspace.activity.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-700">{item.actor} {item.action.toLowerCase()} {item.target}</div>
                  <div className="text-[11px] text-slate-400">{item.timeLabel}</div>
                </div>
              </div>
            ))}
            {workspace.activity.length === 0 ? <EmptyState>No recent activity.</EmptyState> : null}
          </div>
        </UiCard>

        <UiCard title="Recent transfers" actions={<Link to="/portal/transfers" className="ui-caption font-semibold">View all transfers</Link>}>
          <div className="space-y-2">
            {workspace.transfers.slice(0, 5).map((transfer) => (
              <div key={transfer.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-slate-800">{transfer.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{transfer.direction} - {transfer.startedLabel}</div>
                </div>
                <UiBadge tone={transferTone(transfer.status)}>{transfer.status}</UiBadge>
              </div>
            ))}
            {workspace.transfers.length === 0 ? (
              <div className="rounded-md border border-slate-100 px-3 py-4 text-xs font-semibold text-slate-500">
                No recent transfers.
              </div>
            ) : null}
          </div>
        </UiCard>

        <UiCard title="Alerts" actions={<Link to="/portal/activity" className="ui-caption font-semibold">View all alerts</Link>}>
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-slate-800">{alert.title}</div>
                  <div className="truncate text-[11px] text-slate-500">{alert.description}</div>
                </div>
                <UiBadge tone={alertTone(alert.tone)}>{alert.severityLabel ?? "Info"}</UiBadge>
              </div>
            ))}
            {alerts.length === 0 ? <EmptyState>No alerts to display.</EmptyState> : null}
          </div>
        </UiCard>
      </section>
    </div>
  );
}

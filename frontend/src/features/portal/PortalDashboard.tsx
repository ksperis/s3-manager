/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import { storageSpacePath } from "./portalWorkspaceModel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import {
  PortalV3Badge,
  PortalV3Card,
  PortalV3Donut,
  PortalV3Link,
  PortalV3MetricCard,
  PortalV3MiniLineChart,
  PortalV3Page,
  PortalV3PageHeader,
  PortalV3Progress,
} from "./PortalV3Components";

const DONUT_COLORS = ["#2563eb", "#14b8a6", "#64748b", "#f59e0b", "#ef4444", "#94a3b8"];

function percent(used?: number | null, quota?: number | null): number {
  if (used == null || quota == null || quota <= 0) return 0;
  return Math.min(100, Math.max(0, (used / quota) * 100));
}

function alertTone(tone: string) {
  if (tone === "danger") return "rose";
  if (tone === "warning") return "amber";
  if (tone === "info") return "blue";
  return "neutral";
}

function transferTone(status: string) {
  if (status === "Failed") return "rose";
  if (status === "Uploading" || status === "Queued") return "blue";
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
      <PortalV3Page>
        <div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading dashboard...</div>
      </PortalV3Page>
    );
  }

  if (accountError || error) {
    return (
      <PortalV3Page>
        <div className="portal-v3-card p-6 text-sm font-semibold text-rose-600">{accountError ?? error}</div>
      </PortalV3Page>
    );
  }

  if (!hasAccountContext) {
    return (
      <PortalV3Page>
        <div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Select an account to open the dashboard.</div>
      </PortalV3Page>
    );
  }

  return (
    <PortalV3Page>
      <PortalV3PageHeader
        title="Dashboard"
        description={`Welcome back, ${workspace.accountName}`}
        right={
          <div className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm">
            <span>Current period</span>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PortalV3MetricCard label="Total Storage" value={formatBytes(workspace.usedBytes)} delta={workspace.quotaBytes ? `${formatPercentage(percent(workspace.usedBytes, workspace.quotaBytes))} used` : "Quota unavailable"} />
        <PortalV3MetricCard label="Total Objects" value={formatCompactNumber(workspace.usedObjects)} delta={workspace.usedObjects == null ? "Unavailable" : "Tracked"} tone="blue" />
        <PortalV3MetricCard label="Requests" value={formatCompactNumber(workspace.requestCount)} delta={trafficLoading ? "Loading traffic" : workspace.requestCount == null ? "Unavailable" : "From traffic"} tone="green" />
        <PortalV3MetricCard label="Data Out" value={formatBytes(workspace.dataOutBytes)} delta={trafficLoading ? "Loading traffic" : workspace.dataOutBytes == null ? "Unavailable" : "From traffic"} tone="amber" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <PortalV3Card title="Storage usage">
          {topSpaces.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-center">
              <PortalV3Donut segments={donutSegments} center={formatBytes(workspace.usedBytes)} caption={workspace.quotaBytes ? `of ${formatBytes(workspace.quotaBytes)} used` : "quota unavailable"} />
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
        </PortalV3Card>

        <PortalV3Card title="Usage over time">
          {trendValues.length > 0 ? (
            <>
              <PortalV3MiniLineChart values={trendValues} />
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
        </PortalV3Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <PortalV3Card title="Top storage spaces">
          <div className="space-y-3">
            {topSpaces.map((space) => (
              <div key={space.id} className="grid grid-cols-[1fr_auto] gap-3">
                <PortalV3Link to={storageSpacePath(space)}>{space.name}</PortalV3Link>
                <span className="text-xs font-semibold text-slate-500">{formatBytes(space.usedBytes)}</span>
                <div className="col-span-2">
                  <PortalV3Progress value={percent(space.usedBytes, workspace.usedBytes)} />
                </div>
              </div>
            ))}
            {topSpaces.length === 0 ? <EmptyState>No Storage Spaces to display.</EmptyState> : null}
          </div>
        </PortalV3Card>

        <PortalV3Card title="Recent activity" action={<PortalV3Link to="/portal/activity">View all activity</PortalV3Link>}>
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
        </PortalV3Card>

        <PortalV3Card title="Recent transfers" action={<PortalV3Link to="/portal/transfers">View all transfers</PortalV3Link>}>
          <div className="space-y-2">
            {workspace.transfers.slice(0, 5).map((transfer) => (
              <div key={transfer.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-slate-800">{transfer.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{transfer.direction} - {transfer.startedLabel}</div>
                </div>
                <PortalV3Badge tone={transferTone(transfer.status)}>{transfer.status}</PortalV3Badge>
              </div>
            ))}
            {workspace.transfers.length === 0 ? (
              <div className="rounded-md border border-slate-100 px-3 py-4 text-xs font-semibold text-slate-500">
                No recent transfers.
              </div>
            ) : null}
          </div>
        </PortalV3Card>

        <PortalV3Card title="Alerts" action={<PortalV3Link to="/portal/activity">View all alerts</PortalV3Link>}>
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-slate-800">{alert.title}</div>
                  <div className="truncate text-[11px] text-slate-500">{alert.description}</div>
                </div>
                <PortalV3Badge tone={alertTone(alert.tone)}>{alert.severityLabel ?? "Info"}</PortalV3Badge>
              </div>
            ))}
            {alerts.length === 0 ? <EmptyState>No alerts to display.</EmptyState> : null}
          </div>
        </PortalV3Card>
      </section>
    </PortalV3Page>
  );
}

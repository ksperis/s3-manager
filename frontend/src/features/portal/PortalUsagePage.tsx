/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import {
  PortalV3Card,
  PortalV3Donut,
  PortalV3MetricCard,
  PortalV3MiniLineChart,
  PortalV3Page,
  PortalV3PageHeader,
} from "./PortalV3Components";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const COLORS = ["#2563eb", "#14b8a6", "#94a3b8", "#f59e0b", "#ef4444"];

function percent(used?: number | null, quota?: number | null): number {
  if (used == null || quota == null || quota <= 0) return 0;
  return Math.min(100, Math.max(0, (used / quota) * 100));
}

export default function PortalUsagePage() {
  const { workspace, traffic, loading, error, accountError, accountLoading, hasAccountContext } =
    usePortalWorkspaceData({ includeTraffic: true });
  const trendValues =
    (traffic?.series ?? []).length > 0
      ? (traffic?.series ?? []).map((point) => point.bytes_in + point.bytes_out)
      : workspace.usageTrend.map((point) => point.value);
  const donutSegments = workspace.spaces.slice(0, 5).map((space, index) => ({
    value: space.usedBytes ?? 0,
    color: COLORS[index] ?? "#94a3b8",
  }));

  if (accountLoading || loading) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading analytics...</div></PortalV3Page>;
  }

  if (accountError || error || !hasAccountContext) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">{accountError ?? error ?? "Select an account."}</div></PortalV3Page>;
  }

  return (
    <PortalV3Page>
      <PortalV3PageHeader
        title="Usage & Analytics"
        description="Track storage, bandwidth and request trends."
        right={<div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">May 10 - Jun 10, 2024</div>}
      />
      <div className="border-b border-slate-200">
        <div className="flex gap-7">
          {["Overview", "Storage", "Bandwidth", "Top Objects", "Requests"].map((tab, index) => (
            <button key={tab} type="button" className={index === 0 ? "portal-v3-tab portal-v3-tab-active" : "portal-v3-tab"}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PortalV3MetricCard label="Storage Used" value={formatBytes(workspace.usedBytes)} delta={`${formatPercentage(percent(workspace.usedBytes, workspace.quotaBytes))} used`} />
        <PortalV3MetricCard label="Data In" value={formatBytes(workspace.dataInBytes)} delta="+10.5%" tone="green" />
        <PortalV3MetricCard label="Data Out" value={formatBytes(workspace.dataOutBytes)} delta="+8.7%" tone="amber" />
        <PortalV3MetricCard label="Requests" value={formatCompactNumber(workspace.requestCount)} delta="+12.6%" tone="blue" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <PortalV3Card title="Storage over time">
          <PortalV3MiniLineChart values={trendValues} />
          <div className="mt-2 flex justify-between text-[11px] font-semibold text-slate-400">
            {workspace.usageTrend.map((point) => (
              <span key={point.label}>{point.label}</span>
            ))}
          </div>
        </PortalV3Card>

        <PortalV3Card title="Usage by storage space">
          <div className="grid gap-4 md:grid-cols-[190px_1fr] md:items-center">
            <PortalV3Donut segments={donutSegments} center={formatBytes(workspace.usedBytes)} caption="total used" />
            <div className="space-y-3">
              {workspace.spaces.slice(0, 5).map((space, index) => (
                <div key={space.id} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index] ?? "#94a3b8" }} />
                    <span className="truncate font-semibold text-slate-700">{space.name}</span>
                  </div>
                  <span className="shrink-0 text-slate-500">{formatBytes(space.usedBytes)}</span>
                </div>
              ))}
            </div>
          </div>
        </PortalV3Card>
      </section>
      <div className="text-xs font-bold text-blue-600">View all analytics {"->"}</div>
    </PortalV3Page>
  );
}

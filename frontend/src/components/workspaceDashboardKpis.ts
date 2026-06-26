/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import type { ManagerTrafficStats, ManagerUsageTrendBaseline, TrafficWindow } from "../api/stats";
import { formatBytes, formatCompactNumber, formatPercentage } from "../utils/format";
import {
  workspaceTrendWindowDays,
  type WorkspaceDashboardMetric,
  type WorkspaceDashboardMetricTrend,
  type WorkspaceDashboardTone,
} from "./WorkspaceDashboardKit";

export type WorkspaceTrafficTrendSelection = {
  totalBytes: number;
  label: string;
};

export const WORKSPACE_TRAFFIC_TREND_WINDOWS: Array<{ window: TrafficWindow; label: string; minAgeDays: number }> = [
  { window: "month", label: "last 30 days", minAgeDays: 28 },
  { window: "week", label: "last week", minAgeDays: 6 },
  { window: "day", label: "yesterday", minAgeDays: 0 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

type WorkspaceKpiEndpoint = {
  to?: string;
  unavailableReason?: string | null;
};

type WorkspaceKpiStorageConfig = WorkspaceKpiEndpoint & {
  label?: string;
  usedBytes?: number | null;
  quotaBytes?: number | null;
  quotaUnavailableDetail?: string;
  trendBaseline?: ManagerUsageTrendBaseline | null;
  quotaOfLabel?: string;
  trendComparisonLabel?: string;
  progressLabel: string;
  icon: ReactNode;
};

type WorkspaceKpiCountConfig = WorkspaceKpiEndpoint & {
  label: string;
  value?: number | null;
  quota?: number | null;
  unitLabel: string;
  knownDetail?: string;
  activeValue?: number | null;
  activeLabel?: string;
  trendBaseline?: ManagerUsageTrendBaseline | null;
  trendBaselineValue?: number | null;
  quotaOfLabel?: string;
  trendComparisonLabel?: string;
  progressLabel?: string;
  tone: WorkspaceDashboardTone;
  icon: ReactNode;
};

type WorkspaceKpiTransferConfig = WorkspaceKpiEndpoint & {
  label?: string;
  bytes?: number | null;
  loading?: boolean;
  trendSelection?: WorkspaceTrafficTrendSelection | null;
  detailLabel?: string;
  trendComparisonLabel?: string;
  icon: ReactNode;
};

export type BuildWorkspaceDashboardKpisConfig = {
  storage: WorkspaceKpiStorageConfig;
  spaces: WorkspaceKpiCountConfig;
  objects: WorkspaceKpiCountConfig;
  transfer: WorkspaceKpiTransferConfig;
};

export function workspaceDashboardPercent(used?: number | null, quota?: number | null): number | null {
  if (used == null || quota == null || quota <= 0) return null;
  return Math.max(0, Math.min(100, (used / quota) * 100));
}

export function formatWorkspaceDashboardNumber(value?: number | null): string {
  if (value == null) return "-";
  return formatCompactNumber(value)
    .replace(/k$/, " K")
    .replace(/M$/, " M")
    .replace(/B$/, " B");
}

export function formatWorkspaceOptionalBytes(value?: number | null): string {
  return value == null ? "" : formatBytes(value);
}

export function formatWorkspaceOptionalDashboardNumber(value?: number | null): string {
  return value == null ? "" : formatWorkspaceDashboardNumber(value);
}

export function formatWorkspaceQuotaDetail(quota: string, usagePercent?: number | null, ofLabel = "of"): string {
  return usagePercent == null ? `${ofLabel} ${quota}` : `${ofLabel} ${quota} (${formatPercentage(usagePercent)})`;
}

export function formatWorkspaceCountQuotaDetail(
  value: number | null | undefined,
  quota: number,
  unitLabel: string,
  usagePercent?: number | null,
  ofLabel = "of"
): string {
  if (value == null) return formatWorkspaceQuotaDetail(`${formatWorkspaceDashboardNumber(quota)} ${unitLabel}`, usagePercent, ofLabel);
  const detail = `${formatWorkspaceDashboardNumber(value)} / ${formatWorkspaceDashboardNumber(quota)} ${unitLabel}`;
  return usagePercent == null ? detail : `${detail} (${formatPercentage(usagePercent)})`;
}

export function workspaceTrafficTotalBytes(stats?: ManagerTrafficStats | null): number {
  if (!stats) return 0;
  return (stats.totals.bytes_in ?? 0) + (stats.totals.bytes_out ?? 0);
}

function hasTrafficPointAtLeast(stats: ManagerTrafficStats, minAgeDays: number): boolean {
  if (minAgeDays <= 0) return true;
  const endMs = new Date(stats.end).getTime();
  if (!Number.isFinite(endMs)) return false;
  const threshold = endMs - minAgeDays * DAY_MS;
  return (stats.series ?? []).some((point) => {
    const pointMs = new Date(point.timestamp).getTime();
    return Number.isFinite(pointMs) && pointMs <= threshold;
  });
}

export function selectWorkspaceTrafficTrend(
  statsByWindow: Partial<Record<TrafficWindow, ManagerTrafficStats>>
): WorkspaceTrafficTrendSelection | null {
  for (const option of WORKSPACE_TRAFFIC_TREND_WINDOWS) {
    const stats = statsByWindow[option.window];
    if (!stats) continue;
    const totalBytes = workspaceTrafficTotalBytes(stats);
    if (totalBytes <= 0) continue;
    if (!hasTrafficPointAtLeast(stats, option.minAgeDays)) continue;
    return { totalBytes, label: option.label };
  }
  return null;
}

export function formatWorkspaceTrafficTrend(
  selection: WorkspaceTrafficTrendSelection | null,
  comparisonLabel = "vs"
): WorkspaceDashboardMetricTrend | undefined {
  if (!selection) return undefined;
  const valueLabel = formatBytes(selection.totalBytes);
  const qualifierLabel = ` ${comparisonLabel} ${selection.label}`;
  return { label: `${valueLabel}${qualifierLabel}`, valueLabel, qualifierLabel, tone: "positive" };
}

export function formatWorkspaceSignedTrend(
  currentValue: number | null | undefined,
  baselineValue: number | null | undefined,
  label: string,
  formatter: (value: number) => string,
  comparisonLabel = "vs"
): WorkspaceDashboardMetricTrend | undefined {
  if (currentValue == null || baselineValue == null || !label) return undefined;
  const delta = currentValue - baselineValue;
  const tone: WorkspaceDashboardMetricTrend["tone"] = delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
  const valueLabel = formatter(Math.abs(delta));
  const qualifierLabel = ` ${comparisonLabel} ${label}`;
  return { label: `${valueLabel}${qualifierLabel}`, valueLabel, qualifierLabel, tone };
}

export function formatWorkspaceStorageTrend(
  currentValue: number | null | undefined,
  baseline?: ManagerUsageTrendBaseline | null,
  comparisonLabel = "vs"
): WorkspaceDashboardMetricTrend | undefined {
  return formatWorkspaceSignedTrend(currentValue, baseline?.used_bytes, baseline?.label ?? "", formatBytes, comparisonLabel);
}

export function workspaceStorageGrowthDelta(
  currentValue: number | null | undefined,
  baseline?: ManagerUsageTrendBaseline | null
): number | null {
  return currentValue == null || baseline?.used_bytes == null ? null : currentValue - baseline.used_bytes;
}

export function formatWorkspaceSignedBytesDelta(value: number | null): string {
  if (value == null) return "-";
  if (value === 0) return "0 B";
  return `${value > 0 ? "+" : "-"}${formatBytes(Math.abs(value))}`;
}

export type WorkspaceProjectedFullLabels = {
  unavailable?: string;
  full?: string;
  stable?: string;
  days?: (value: number) => string;
  months?: (value: number) => string;
  years?: (value: number) => string;
};

export function formatWorkspaceProjectedFull(
  currentValue: number | null | undefined,
  quotaValue: number | null | undefined,
  baseline?: ManagerUsageTrendBaseline | null,
  labels: WorkspaceProjectedFullLabels = {}
): string {
  const unavailableLabel = labels.unavailable ?? "-";
  if (currentValue == null || quotaValue == null || quotaValue <= 0) return unavailableLabel;
  if (currentValue >= quotaValue) return labels.full ?? "Full";
  const baselineValue = baseline?.used_bytes;
  if (baselineValue == null) return unavailableLabel;
  const delta = currentValue - baselineValue;
  if (delta <= 0) return labels.stable ?? "Stable";
  const dailyGrowth = delta / workspaceTrendWindowDays(baseline);
  if (dailyGrowth <= 0) return labels.stable ?? "Stable";
  const daysToFull = (quotaValue - currentValue) / dailyGrowth;
  if (!Number.isFinite(daysToFull)) return unavailableLabel;
  if (daysToFull < 45) {
    const days = Math.max(1, Math.round(daysToFull));
    return labels.days?.(days) ?? `~${days} days`;
  }
  const monthsToFull = daysToFull / 30;
  if (monthsToFull < 24) {
    const months = Math.max(1, Math.round(monthsToFull));
    return labels.months?.(months) ?? `~${months} months`;
  }
  const years = Math.max(1, Math.round(monthsToFull / 12));
  return labels.years?.(years) ?? `~${years} years`;
}

export function formatWorkspaceCountTrend(
  currentValue: number | null | undefined,
  baselineValue: number | null | undefined,
  baseline?: ManagerUsageTrendBaseline | null,
  comparisonLabel = "vs"
): WorkspaceDashboardMetricTrend | undefined {
  return formatWorkspaceSignedTrend(currentValue, baselineValue, baseline?.label ?? "", formatWorkspaceDashboardNumber, comparisonLabel);
}

function formatCountValue(value: number | null | undefined): string {
  return value == null ? "" : value.toLocaleString();
}

function buildCountMetric(config: WorkspaceKpiCountConfig): WorkspaceDashboardMetric {
  const progress = workspaceDashboardPercent(config.value, config.quota);
  const detail =
    config.quota != null
      ? formatWorkspaceCountQuotaDetail(config.value, config.quota, config.unitLabel, progress, config.quotaOfLabel)
      : config.activeValue != null && config.activeLabel
        ? `${config.activeValue.toLocaleString()} ${config.activeLabel}`
        : config.value == null
          ? ""
          : config.knownDetail ?? config.unitLabel;

  return {
    label: config.label,
    value: formatCountValue(config.value),
    detail,
    progress,
    progressLabel: config.progressLabel,
    trend: formatWorkspaceCountTrend(config.value, config.trendBaselineValue, config.trendBaseline, config.trendComparisonLabel),
    tone: config.tone,
    icon: config.icon,
    to: config.to,
    unavailableReason: config.unavailableReason,
  };
}

export function buildWorkspaceDashboardKpis(config: BuildWorkspaceDashboardKpisConfig): WorkspaceDashboardMetric[] {
  const storagePercent = workspaceDashboardPercent(config.storage.usedBytes, config.storage.quotaBytes);
  const storageMetric: WorkspaceDashboardMetric = {
    label: config.storage.label ?? "Storage used",
    value: formatWorkspaceOptionalBytes(config.storage.usedBytes),
    detail:
      config.storage.quotaBytes == null
        ? config.storage.quotaUnavailableDetail ?? ""
        : formatWorkspaceQuotaDetail(formatBytes(config.storage.quotaBytes), storagePercent, config.storage.quotaOfLabel),
    progress: storagePercent,
    progressLabel: config.storage.progressLabel,
    trend: formatWorkspaceStorageTrend(config.storage.usedBytes, config.storage.trendBaseline, config.storage.trendComparisonLabel),
    tone: "blue",
    icon: config.storage.icon,
    to: config.storage.to,
    unavailableReason: config.storage.unavailableReason,
  };

  const transferValue = config.transfer.loading ? "..." : formatWorkspaceOptionalBytes(config.transfer.bytes);
  const transferMetric: WorkspaceDashboardMetric = {
    label: config.transfer.label ?? "Transfer",
    value: transferValue,
    detail: config.transfer.bytes == null ? "" : config.transfer.detailLabel ?? "Last 24h",
    trend: config.transfer.loading || config.transfer.bytes == null
      ? undefined
      : formatWorkspaceTrafficTrend(config.transfer.trendSelection ?? null, config.transfer.trendComparisonLabel),
    tone: "amber",
    icon: config.transfer.icon,
    to: config.transfer.to,
    unavailableReason: config.transfer.unavailableReason,
  };

  return [
    storageMetric,
    buildCountMetric(config.spaces),
    buildCountMetric(config.objects),
    transferMetric,
  ];
}

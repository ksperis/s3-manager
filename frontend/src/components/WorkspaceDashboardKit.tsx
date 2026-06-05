/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { HealthCheckStatus } from "../api/healthchecks";
import UiBadge from "./ui/UiBadge";
import { cx, uiCardClass, uiMutedTextClass } from "./ui/styles";

export const WORKSPACE_DASHBOARD_MOCK_SERIES = [24, 38, 31, 56, 49, 68, 45, 76, 61, 72, 58, 81];

export type WorkspaceDashboardFeature = {
  id: string;
  label: string;
  enabled: boolean;
  massManagement?: boolean;
};

export type WorkspaceDashboardFeatureGroup = {
  title: string;
  features: WorkspaceDashboardFeature[];
};

export type WorkspaceDashboardTone = "amber" | "blue" | "indigo" | "emerald" | "violet";

export type WorkspaceDashboardStatCardItem = {
  id: string;
  label: string;
  value: string | number;
  hint: string;
  to: string;
  tone: WorkspaceDashboardTone;
  icon: ReactNode;
};

export type WorkspacePlatformMetric = {
  label: string;
  value: string;
  delta?: string;
  series?: number[];
  tone: "blue" | "violet" | "emerald";
  unavailableReason?: string;
};

export function workspaceStatusLabel(status: HealthCheckStatus): string {
  if (status === "up") return "Up";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  return "Unknown";
}

export function workspaceStatusDotClass(status: HealthCheckStatus): string {
  if (status === "up") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "down") return "bg-rose-500";
  return "bg-slate-400";
}

export function workspaceStatusPillClass(status: HealthCheckStatus): string {
  if (status === "up") {
    return "border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300";
  }
  if (status === "degraded") {
    return "border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300";
  }
  if (status === "down") {
    return "border-rose-200/80 bg-rose-50/80 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300";
  }
  return "border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text-muted)] dark:border-slate-700 dark:bg-slate-800/40";
}

export function WorkspaceStatusDot({ status, className }: { status: HealthCheckStatus; className?: string }) {
  return <span className={cx("h-2 w-2 rounded-full", workspaceStatusDotClass(status), className)} />;
}

export function WorkspaceStatusPill({ status, className }: { status: HealthCheckStatus; className?: string }) {
  return (
    <span className={cx("rounded-md border px-2 py-0.5 font-semibold leading-4", workspaceStatusPillClass(status), className)}>
      {workspaceStatusLabel(status)}
    </span>
  );
}

function statToneClass(tone: WorkspaceDashboardTone): string {
  if (tone === "amber") return "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-200";
  if (tone === "blue") return "bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-200";
  if (tone === "indigo") return "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-200";
  if (tone === "emerald") return "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-200";
  return "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-200";
}

function metricToneClass(tone: WorkspacePlatformMetric["tone"]): string {
  if (tone === "violet") return "stroke-violet-500";
  if (tone === "emerald") return "stroke-emerald-500";
  return "stroke-primary";
}

function statusCounterPanelClass(status: HealthCheckStatus, value: number): string {
  if (value <= 0) {
    return "border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)]";
  }
  if (status === "up") {
    return "border-emerald-200/80 bg-emerald-50/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:shadow-none";
  }
  if (status === "degraded") {
    return "border-amber-200/80 bg-amber-50/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-amber-500/25 dark:bg-amber-500/10 dark:shadow-none";
  }
  if (status === "down") {
    return "border-rose-200/80 bg-rose-50/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-rose-500/25 dark:bg-rose-500/10 dark:shadow-none";
  }
  return "border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)]";
}

function statusCounterLabelClass(status: HealthCheckStatus, value: number): string {
  if (value <= 0) return "text-[var(--ui-text-muted)]";
  if (status === "up") return "text-emerald-700 dark:text-emerald-300";
  if (status === "degraded") return "text-amber-700 dark:text-amber-300";
  if (status === "down") return "text-rose-700 dark:text-rose-300";
  return "text-[var(--ui-text-muted)]";
}

function normalizeSeries(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const span = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 48 : (index / (values.length - 1)) * 96;
      const y = 34 - ((value - min) / span) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function WorkspaceDashboardUnavailableFrame({
  reason,
  children,
  className,
}: {
  reason: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("relative overflow-hidden", className)}>
      <div aria-hidden="true" className="pointer-events-none select-none blur-[2.5px]">
        {children}
      </div>
      <div className="absolute inset-x-3 bottom-3 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)]/95 px-3 py-2 ui-caption font-medium text-[var(--ui-text-muted)] shadow-[var(--ui-shadow-soft)]">
        {reason}
      </div>
    </div>
  );
}

export function WorkspaceDashboardSparkline({
  values,
  tone,
  unavailableReason,
}: {
  values: number[];
  tone: WorkspacePlatformMetric["tone"];
  unavailableReason?: string;
}) {
  const points = normalizeSeries(values.length > 0 ? values : WORKSPACE_DASHBOARD_MOCK_SERIES);
  const chart = (
    <svg viewBox="0 0 96 34" className="h-[30px] w-full" role="img" aria-label="Trend line">
      <polyline points={points} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={metricToneClass(tone)} />
    </svg>
  );

  if (!unavailableReason) return chart;
  return (
    <div className="relative">
      <div aria-hidden="true" className="blur-[2px]">
        {chart}
      </div>
      <p className="absolute bottom-0 left-0 rounded bg-[var(--ui-surface)]/80 px-1 text-[10px] font-medium leading-3 text-[var(--ui-text-muted)] opacity-75">
        {unavailableReason}
      </p>
    </div>
  );
}

export function WorkspaceDashboardStatCard({
  card,
  loading,
}: {
  card: WorkspaceDashboardStatCardItem;
  loading: boolean;
}) {
  return (
    <Link
      to={card.to}
      className={cx(
        uiCardClass,
        "group flex min-h-[86px] items-center gap-3 px-4 py-3 transition hover:-translate-y-[1px] hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      )}
    >
      <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-md", statToneClass(card.tone))}>
        {card.icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase leading-4 text-[var(--ui-text-muted)]">{card.label}</span>
        <span className="mt-0.5 block text-[20px] font-semibold leading-6 text-[var(--ui-text)]">
          {loading ? "..." : card.value}
        </span>
        <span className="mt-0.5 block truncate ui-caption text-[var(--ui-text-muted)]">{card.hint}</span>
      </span>
    </Link>
  );
}

export function WorkspaceFeatureSummaryCard({ group }: { group: WorkspaceDashboardFeatureGroup }) {
  const enabledFeatures = group.features.filter((feature) => feature.enabled);
  return (
    <section
      aria-label={`${group.title} summary`}
      className={cx(uiCardClass, "flex min-h-[66px] flex-col justify-between gap-2 px-4 py-3")}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="ui-body font-semibold text-[var(--ui-text)]">{group.title}</h2>
        <UiBadge
          tone={enabledFeatures.length > 0 ? "success" : "neutral"}
          className="rounded-md px-2 py-0 text-[11px] leading-5"
        >
          {enabledFeatures.length} enabled
        </UiBadge>
      </div>
      {enabledFeatures.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {enabledFeatures.map((feature) => (
            <UiBadge key={feature.id} tone="success" className="gap-1.5 rounded-md px-2 py-0 text-[11px] leading-5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>{feature.label}</span>
              {feature.massManagement && (
                <span
                  title="Mass management"
                  className="rounded-md border border-emerald-300 bg-emerald-50 px-1 text-[9px] font-bold leading-3 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200"
                >
                  MM
                </span>
              )}
            </UiBadge>
          ))}
        </div>
      ) : (
        <p className={cx("ui-caption", uiMutedTextClass)}>None enabled</p>
      )}
    </section>
  );
}

export function WorkspaceStatusCounter({
  label,
  value,
  status,
}: {
  label: string;
  value: number;
  status: HealthCheckStatus;
}) {
  return (
    <div
      className={cx(
        "min-h-[48px] rounded-md border px-3 py-2",
        statusCounterPanelClass(status, value)
      )}
    >
      <p className={cx("ui-caption font-semibold", statusCounterLabelClass(status, value))}>{label}</p>
      <p className="mt-1 text-[18px] font-semibold leading-5 text-[var(--ui-text)]">{value}</p>
    </div>
  );
}

export function WorkspacePlatformMetricCard({ metric }: { metric: WorkspacePlatformMetric }) {
  const valueContent = (
    <>
      <p className="ui-caption font-medium text-[var(--ui-text-muted)]">{metric.label}</p>
      <div className="mt-1 flex min-h-6 items-baseline gap-2">
        <p className="text-[19px] font-semibold leading-6 text-[var(--ui-text)]">{metric.value}</p>
        {metric.delta && <p className="text-[11px] font-semibold leading-4 text-emerald-600 dark:text-emerald-300">{metric.delta}</p>}
      </div>
    </>
  );
  return (
    <div className="min-w-0 border-l border-[color:var(--ui-border-soft)] px-3 first:border-l-0 first:pl-0 last:pr-0">
      {metric.unavailableReason && metric.value === "-" ? (
        <div className="relative">
          <div aria-hidden="true" className="blur-[2px]">
            {valueContent}
          </div>
          <p className="mt-1 ui-caption text-[var(--ui-text-muted)]">{metric.unavailableReason}</p>
        </div>
      ) : (
        valueContent
      )}
      <div className="mt-2 max-w-[150px]">
        <WorkspaceDashboardSparkline
          values={metric.series ?? WORKSPACE_DASHBOARD_MOCK_SERIES}
          tone={metric.tone}
          unavailableReason={metric.unavailableReason && metric.value !== "-" ? metric.unavailableReason : undefined}
        />
      </div>
    </div>
  );
}

export function WorkspaceHealthScorePanel({
  score,
  loading,
  unavailableReason,
}: {
  score: number | null;
  loading: boolean;
  unavailableReason?: string | null;
}) {
  const displayScore = score ?? 98;
  const scoreLabel = loading ? "..." : `${displayScore}%`;
  const scoreCaption = loading ? "Loading" : displayScore >= 90 ? "Excellent" : displayScore >= 70 ? "Good" : "Check";
  const content = (
    <div className="flex h-full min-h-[96px] flex-col items-center justify-center text-center">
      <p className={cx("text-[11px] font-semibold leading-4", uiMutedTextClass)}>Health score</p>
      <div
        className="mt-2 flex h-20 w-20 items-center justify-center rounded-full p-1"
        style={{
          background: `conic-gradient(#16a34a ${loading ? 0 : displayScore}%, var(--ui-border-soft) 0)`,
        }}
      >
        <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[var(--ui-surface)]">
          <p className="text-[22px] font-semibold leading-6 text-[var(--ui-text)]">{scoreLabel}</p>
          <p className="text-[11px] font-semibold leading-4 text-emerald-600 dark:text-emerald-300">
            {scoreCaption}
          </p>
        </div>
      </div>
    </div>
  );
  if (!unavailableReason) return content;
  return <WorkspaceDashboardUnavailableFrame reason={unavailableReason} className="h-full">{content}</WorkspaceDashboardUnavailableFrame>;
}

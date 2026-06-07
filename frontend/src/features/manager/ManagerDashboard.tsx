/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listBuckets, type Bucket } from "../../api/buckets";
import {
  fetchManagerWorkspaceHealthOverview,
  type HealthCheckStatus,
  type WorkspaceEndpointHealthEntry,
  type WorkspaceEndpointHealthOverviewResponse,
  type WorkspaceEndpointIncidentEntry,
} from "../../api/healthchecks";
import { listManagerActivity, type ManagerActivityEntry } from "../../api/managerActivity";
import { fetchManagerTraffic, type ManagerTrafficStats } from "../../api/stats";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageHeader from "../../components/PageHeader";
import { WorkspaceStatusDot } from "../../components/WorkspaceDashboardKit";
import UiBadge from "../../components/ui/UiBadge";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiCardClass,
  uiMutedTextClass,
} from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import {
  BellIcon,
  BucketIcon,
  FileIcon,
  FolderPlusIcon,
  GroupIcon,
  HistoryIcon,
  InfoIcon,
  OpenIcon,
  RefreshIcon,
  SettingsIcon,
  ShieldIcon,
  UploadIcon,
  UserIcon,
} from "../browser/browserIcons";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";
import { useIamOverview } from "./useIamOverview";
import { useManagerStats } from "./useManagerStats";
import { useS3AccountContext } from "./S3AccountContext";

type DashboardTone = "blue" | "emerald" | "violet" | "amber";

type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
  trend?: string;
  progress?: number | null;
  tone: DashboardTone;
  icon: ReactNode;
  to?: string;
  unavailableReason?: string | null;
};

type BucketRankingRow = {
  name: string;
  storageBytes: number | null;
  objectCount: number | null;
  percent: number;
};

type ActivityRow = {
  label: string;
  detail: string;
  time: string;
  tone: DashboardTone;
  icon: ReactNode;
};

type QuickAction = {
  label: string;
  to: string;
  icon: ReactNode;
  tone: DashboardTone;
  unavailableReason?: string | null;
};

function percent(used?: number | null, quota?: number | null): number | null {
  if (used == null || quota == null || quota <= 0) return null;
  return Math.max(0, Math.min(100, (used / quota) * 100));
}

function formatTimestamp(value?: string | Date | null): string {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return typeof value === "string" ? value : "-";
  return parsed.toLocaleString();
}

function formatRelativeTime(value?: string | null, now = Date.now()): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const diffMs = Math.max(0, now - parsed.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDashboardNumber(value?: number | null): string {
  if (value == null) return "-";
  return formatCompactNumber(value)
    .replace(/k$/, " K")
    .replace(/M$/, " M")
    .replace(/B$/, " B");
}

function formatOptionalBytes(value?: number | null): string {
  return value == null ? "" : formatBytes(value);
}

function formatOptionalDashboardNumber(value?: number | null): string {
  return value == null ? "" : formatDashboardNumber(value);
}

function formatLatency(value?: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value)} ms`;
}

function formatStatus(status: HealthCheckStatus): string {
  if (status === "up") return "Operational";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  return "Unknown";
}

function normalizeActionLabel(action: string): string {
  return action
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function activityPresentation(log: ManagerActivityEntry): { label: string; tone: DashboardTone; icon: ReactNode } {
  const action = log.action.toLowerCase();
  const entityType = (log.entity_type ?? "").toLowerCase();
  if (entityType === "bucket" || action.includes("bucket")) {
    return { label: bucketActionLabel(action), tone: "emerald", icon: <BucketIcon className="h-4 w-4" /> };
  }
  if (entityType.includes("user") || action.includes("iam_user") || action.includes("access_key")) {
    return { label: iamActionLabel(action, "IAM user"), tone: "blue", icon: <UserIcon className="h-4 w-4" /> };
  }
  if (entityType.includes("group") || action.includes("iam_group")) {
    return { label: iamActionLabel(action, "IAM group"), tone: "emerald", icon: <GroupIcon className="h-4 w-4" /> };
  }
  if (entityType.includes("role") || action.includes("iam_role")) {
    return { label: iamActionLabel(action, "IAM role"), tone: "amber", icon: <ShieldIcon className="h-4 w-4" /> };
  }
  if (entityType.includes("policy") || action.includes("policy")) {
    return { label: iamActionLabel(action, "Policy"), tone: "violet", icon: <FileIcon className="h-4 w-4" /> };
  }
  if (entityType.includes("topic") || action.includes("topic")) {
    return { label: genericEntityActionLabel(action, "Topic"), tone: "emerald", icon: <BellIcon className="h-4 w-4" /> };
  }
  if (action.includes("migration")) {
    return { label: genericEntityActionLabel(action, "Migration"), tone: "violet", icon: <HistoryIcon className="h-4 w-4" /> };
  }
  if (entityType.includes("object") || action.includes("object")) {
    return { label: genericEntityActionLabel(action, "Object"), tone: "amber", icon: <UploadIcon className="h-4 w-4" /> };
  }
  return { label: normalizeActionLabel(log.action), tone: "blue", icon: <InfoIcon className="h-4 w-4" /> };
}

function bucketActionLabel(action: string): string {
  if (action.includes("create")) return "Bucket created";
  if (action.includes("delete")) return "Bucket deleted";
  if (action.includes("lifecycle")) return "Lifecycle updated";
  if (action.includes("versioning")) return "Versioning updated";
  if (action.includes("notification")) return "Notifications updated";
  if (action.includes("replication")) return "Replication updated";
  if (action.includes("policy")) return "Bucket policy updated";
  if (action.includes("tag")) return "Bucket tags updated";
  if (action.includes("quota")) return "Bucket quota updated";
  if (action.includes("compare")) return "Bucket compare updated";
  return "Bucket updated";
}

function iamActionLabel(action: string, entityLabel: string): string {
  if (action.includes("create")) return `${entityLabel} created`;
  if (action.includes("delete")) return `${entityLabel} deleted`;
  if (action.includes("attach")) return `${entityLabel} policy attached`;
  if (action.includes("detach")) return `${entityLabel} policy detached`;
  if (action.includes("status")) return `${entityLabel} status updated`;
  if (action.includes("key")) return `${entityLabel} key updated`;
  if (action.includes("policy")) return `${entityLabel} policy updated`;
  return `${entityLabel} updated`;
}

function genericEntityActionLabel(action: string, entityLabel: string): string {
  if (action.includes("create")) return `${entityLabel} created`;
  if (action.includes("delete")) return `${entityLabel} deleted`;
  return `${entityLabel} updated`;
}

function buildActivityRows(logs: ManagerActivityEntry[]): ActivityRow[] {
  return logs.map((log) => {
    const presentation = activityPresentation(log);
    return {
      ...presentation,
      detail: log.entity_id || log.account_name || log.user_email,
      time: formatRelativeTime(log.created_at),
    };
  });
}

function toneClasses(tone: DashboardTone) {
  if (tone === "emerald") {
    return {
      icon: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
      soft: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
      bar: "bg-emerald-500",
    };
  }
  if (tone === "violet") {
    return {
      icon: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
      soft: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
      bar: "bg-violet-500",
    };
  }
  if (tone === "amber") {
    return {
      icon: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
      soft: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
      bar: "bg-amber-500",
    };
  }
  return {
    icon: "bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-200",
    soft: "bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-200",
    bar: "bg-primary",
  };
}

function DashboardUnavailable({
  children,
  className,
}: {
  reason?: string | null;
  children: ReactNode;
  className?: string;
}) {
  if (!className) return <>{children}</>;
  return <div className={className}>{children}</div>;
}

function ProgressBar({ value, tone = "blue", className }: { value?: number | null; tone?: DashboardTone; className?: string }) {
  const width = `${Math.max(0, Math.min(100, value ?? 0))}%`;
  return (
    <div className={cx("h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/60", className)}>
      <div className={cx("h-full rounded-full", toneClasses(tone).bar)} style={{ width }} />
    </div>
  );
}

function IconBubble({ tone, children, className }: { tone: DashboardTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-full", toneClasses(tone).icon, className)}>
      {children}
    </span>
  );
}

function MetricCard({ metric }: { metric: DashboardMetric }) {
  const content = (
    <div className={cx(uiCardClass, "flex min-h-[120px] items-center gap-4 px-4 py-3.5")}>
      <IconBubble tone={metric.tone} className="h-12 w-12">
        {metric.icon}
      </IconBubble>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-semibold uppercase leading-4 text-[var(--ui-text-muted)]">{metric.label}</p>
          {metric.label === "Storage used" && <InfoIcon className="h-3.5 w-3.5 text-[var(--ui-text-muted)]" />}
        </div>
        <p className="mt-1 text-[23px] font-semibold leading-7 text-[var(--ui-text)]">{metric.value}</p>
        <p className={cx("mt-1 ui-body", uiMutedTextClass)}>{metric.detail}</p>
        {metric.progress != null && <ProgressBar value={metric.progress} tone={metric.tone} className="mt-2 max-w-[210px]" />}
        {metric.trend && <p className="mt-2 ui-caption font-medium text-emerald-600 dark:text-emerald-300">{metric.trend}</p>}
      </div>
    </div>
  );

  const framed = (
    <DashboardUnavailable reason={metric.unavailableReason} className="h-full">
      {content}
    </DashboardUnavailable>
  );
  if (!metric.to || metric.unavailableReason) return framed;
  return (
    <Link
      to={metric.to}
      className="block h-full rounded-lg transition hover:-translate-y-[1px] hover:shadow-[var(--shell-menu-shadow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {content}
    </Link>
  );
}

function StorageOverviewCard({
  usedBytes,
  quotaBytes,
  unavailableReason,
}: {
  usedBytes: number | null;
  quotaBytes: number | null;
  unavailableReason?: string | null;
}) {
  const usagePercent = unavailableReason ? null : percent(usedBytes, quotaBytes);
  const storageValue = unavailableReason ? "" : formatOptionalBytes(usedBytes);
  const quotaValue = unavailableReason || quotaBytes == null ? "" : formatBytes(quotaBytes);
  const content = (
    <section className={cx(uiCardClass, "h-full p-4")}>
      <div className="flex items-center gap-1.5">
        <h2 className="ui-subtitle font-semibold text-[var(--ui-text)]">Storage overview</h2>
        <InfoIcon className="h-3.5 w-3.5 text-[var(--ui-text-muted)]" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <p className={cx("ui-body", uiMutedTextClass)}>Storage Used</p>
          <p className="mt-1 text-[24px] font-semibold leading-7 text-[var(--ui-text)]">
            {storageValue}
            {quotaValue && <span className="font-medium text-[var(--ui-text)]/75"> / {quotaValue}</span>}
          </p>
        </div>
        <p className="text-[20px] font-semibold leading-6 text-primary">{usagePercent == null ? "" : formatPercentage(usagePercent)}</p>
      </div>
      {usagePercent != null && <ProgressBar value={usagePercent} className="mt-3 h-2.5" />}
      <div className="mt-3 h-[66px] border-b border-dashed border-[color:var(--ui-border-soft)]" aria-hidden="true" />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="h-full">
          <div className="min-h-[55px] rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-1.5">
            <p className="text-[10px] font-semibold leading-4 text-[var(--ui-text-muted)]">Growth (30 days)</p>
          </div>
        </div>
        <div className="h-full">
          <div className="min-h-[55px] rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold leading-4 text-[var(--ui-text-muted)]">Projected full</p>
              <InfoIcon className="h-3.5 w-3.5 text-[var(--ui-text-muted)]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <DashboardUnavailable reason={unavailableReason} className="h-full">
      {content}
    </DashboardUnavailable>
  );
}

function TopBucketsCard({
  rows,
  unavailableReason,
}: {
  rows: BucketRankingRow[];
  unavailableReason?: string | null;
}) {
  const content = (
    <section className={cx(uiCardClass, "h-full p-4")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="ui-subtitle font-semibold text-[var(--ui-text)]">Top buckets by storage</h2>
        <Link to="/manager/buckets" className="inline-flex items-center gap-2 ui-caption font-semibold text-primary">
          View all buckets
          <OpenIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1.2fr)_minmax(92px,0.8fr)_minmax(72px,0.5fr)] gap-3 text-[11px] font-semibold leading-4 text-[var(--ui-text-muted)]">
        <span>Bucket</span>
        <span>Storage</span>
        <span className="text-right">Objects</span>
      </div>
      <div className="mt-2 space-y-2">
        {rows.map((row) => (
          <div
            key={row.name}
            className="grid min-h-7 grid-cols-[minmax(0,1.2fr)_minmax(92px,0.8fr)_minmax(72px,0.5fr)] items-center gap-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <IconBubble tone="emerald" className="h-6 w-6 rounded-md">
                <BucketIcon className="h-3.5 w-3.5" />
              </IconBubble>
              <span className="truncate ui-caption font-semibold text-[var(--ui-text)]">{row.name}</span>
            </div>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3">
              <span className="ui-caption font-semibold text-[var(--ui-text)]">{formatBytes(row.storageBytes)}</span>
              <ProgressBar value={row.percent} className="h-1.5" />
            </div>
            <span className="text-right ui-caption font-semibold text-[var(--ui-text)]">
              {formatDashboardNumber(row.objectCount)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
  return (
    <DashboardUnavailable reason={unavailableReason} className="h-full">
      {content}
    </DashboardUnavailable>
  );
}

function RecentActivityCard({
  rows,
  loading,
  unavailableReason,
}: {
  rows: ActivityRow[];
  loading: boolean;
  unavailableReason?: string | null;
}) {
  const content = (
    <section className={cx(uiCardClass, "h-full p-4")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="ui-subtitle font-semibold text-[var(--ui-text)]">Recent activity</h2>
        <span className="inline-flex items-center gap-2 ui-caption font-semibold text-primary">
          View all
          <OpenIcon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((key) => (
              <div key={key} className="h-8 animate-pulse rounded-md bg-[var(--ui-surface-muted)]" />
            ))}
          </div>
        ) : rows.length === 0 && !unavailableReason ? (
          <div className="rounded-md border border-dashed border-[color:var(--ui-border-soft)] px-3 py-6 text-center ui-caption text-[var(--ui-text-muted)]">
            No recent activity.
          </div>
        ) : (
          rows.map((activity) => (
            <div key={`${activity.label}-${activity.detail}-${activity.time}`} className="flex items-start justify-between gap-3">
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
          ))
        )}
      </div>
    </section>
  );
  return (
    <DashboardUnavailable reason={unavailableReason} className="h-full">
      {content}
    </DashboardUnavailable>
  );
}

function QuotaStatusCard({
  storageUsed,
  storageQuota,
  objectCount,
  objectQuota,
  unavailableReason,
}: {
  storageUsed: number | null;
  storageQuota: number | null;
  objectCount: number | null;
  objectQuota: number | null;
  unavailableReason?: string | null;
}) {
  const visibleStorageUsed = unavailableReason ? null : storageUsed;
  const visibleStorageQuota = unavailableReason ? null : storageQuota;
  const visibleObjectCount = unavailableReason ? null : objectCount;
  const visibleObjectQuota = unavailableReason ? null : objectQuota;
  const storagePercent = percent(visibleStorageUsed, visibleStorageQuota);
  const objectPercent = percent(visibleObjectCount, visibleObjectQuota);
  const rows = [
    {
      label: "Storage",
      value:
        visibleStorageUsed == null
          ? ""
          : visibleStorageQuota == null
            ? formatBytes(visibleStorageUsed)
            : `${formatBytes(visibleStorageUsed)} / ${formatBytes(visibleStorageQuota)}`,
      percent: storagePercent,
      tone: "blue" as DashboardTone,
      icon: <BucketIcon className="h-3.5 w-3.5" />,
    },
    {
      label: "Objects",
      value:
        visibleObjectCount == null
          ? ""
          : visibleObjectQuota == null
            ? formatDashboardNumber(visibleObjectCount)
            : `${formatDashboardNumber(visibleObjectCount)} / ${formatDashboardNumber(visibleObjectQuota)}`,
      percent: objectPercent,
      tone: "blue" as DashboardTone,
      icon: <FileIcon className="h-3.5 w-3.5" />,
    },
    {
      label: "Buckets",
      value: "",
      percent: null,
      tone: "blue" as DashboardTone,
      icon: <BucketIcon className="h-3.5 w-3.5" />,
    },
    {
      label: "Bandwidth (month)",
      value: "",
      percent: null,
      tone: "violet" as DashboardTone,
      icon: <SettingsIcon className="h-3.5 w-3.5" />,
    },
  ];
  const content = (
    <section className={cx(uiCardClass, "h-full p-[14px]")}>
      <h2 className="ui-body font-semibold text-[var(--ui-text)]">Quota status</h2>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="relative">
            <div className="grid grid-cols-[minmax(96px,1fr)_minmax(112px,1.2fr)_42px] items-center gap-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <IconBubble tone={row.tone} className="h-6 w-6 rounded-md">
                  {row.icon}
                </IconBubble>
                <span className="truncate ui-caption font-semibold text-[var(--ui-text)]">{row.label}</span>
              </div>
              <div>
                <p className="ui-caption font-medium text-[var(--ui-text)]">{row.value}</p>
                {row.percent != null && <ProgressBar value={row.percent} className="mt-1 h-1.5" />}
              </div>
              <span className="text-right ui-caption font-semibold text-[var(--ui-text)]">
                {row.percent == null ? "" : formatPercentage(row.percent)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
  return (
    <DashboardUnavailable reason={unavailableReason} className="h-full">
      {content}
    </DashboardUnavailable>
  );
}

function QuickActionsCard({ actions }: { actions: QuickAction[] }) {
  return (
    <section className={cx(uiCardClass, "h-full p-[14px]")}>
      <h2 className="ui-body font-semibold text-[var(--ui-text)]">Quick actions</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {actions.map((action) => {
          const content = (
            <span
              className={cx(
                "flex min-h-[40px] items-center justify-between gap-1.5 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-2 py-1.5 text-left transition",
                action.unavailableReason
                  ? "cursor-not-allowed opacity-65"
                  : "hover:border-primary hover:bg-[var(--ui-hover)]"
              )}
              title={action.unavailableReason ?? undefined}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <IconBubble tone={action.tone} className="h-6 w-6 rounded-md">
                  {action.icon}
                </IconBubble>
                <span className="min-w-0 text-[11px] font-semibold leading-[14px] text-[var(--ui-text)]">{action.label}</span>
              </span>
              <OpenIcon className="h-3 w-3 shrink-0 text-[var(--ui-text-muted)]" />
            </span>
          );
          if (action.unavailableReason) {
            return (
              <span key={action.label} aria-disabled="true">
                {content}
              </span>
            );
          }
          return (
            <Link key={action.label} to={action.to}>
              {content}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function AccessManagementCard({
  counts,
  unavailableReason,
}: {
  counts: Array<{ label: string; value: number | null; to: string; tone: DashboardTone; icon: ReactNode }>;
  unavailableReason?: string | null;
}) {
  const content = (
    <section className={cx(uiCardClass, "h-full p-[14px]")}>
      <h2 className="ui-body font-semibold text-[var(--ui-text)]">Access management</h2>
      <div className="mt-3 divide-y divide-[color:var(--ui-border-soft)]">
        {counts.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className="flex min-h-9 items-center justify-between gap-3 py-1.5 transition hover:text-primary"
          >
            <span className="flex min-w-0 items-center gap-3">
              <IconBubble tone={item.tone} className="h-7 w-7 rounded-md">
                {item.icon}
              </IconBubble>
              <span className="truncate ui-caption font-semibold text-[var(--ui-text)]">{item.label}</span>
            </span>
            <span className="flex shrink-0 items-center gap-5">
              <span className={cx("ui-caption font-semibold", uiMutedTextClass)}>{item.value == null ? "" : item.value.toLocaleString()}</span>
              <span className="inline-flex items-center gap-1 ui-caption font-semibold text-primary">
                View all
                <OpenIcon className="h-3.5 w-3.5" />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
  return (
    <DashboardUnavailable reason={unavailableReason} className="h-full">
      {content}
    </DashboardUnavailable>
  );
}

function BackendHealthCard({
  endpoint,
  unavailableReason,
}: {
  endpoint?: WorkspaceEndpointHealthEntry | null;
  unavailableReason?: string | null;
}) {
  const showEndpoint = !unavailableReason && endpoint;
  const content = (
    <section className={cx(uiCardClass, "h-full p-[14px]")}>
      <div className="flex items-center gap-1.5">
        <h2 className="ui-body font-semibold text-[var(--ui-text)]">Storage backend health</h2>
        <InfoIcon className="h-3.5 w-3.5 text-[var(--ui-text-muted)]" />
      </div>
      <div className="mt-3 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-2.5">
        {showEndpoint ? (
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 ui-caption font-semibold text-[var(--ui-text)]">
              <WorkspaceStatusDot status={endpoint.status} />
              <span className="truncate">{endpoint.name}</span>
            </p>
            <UiBadge tone={endpoint.status === "up" ? "success" : endpoint.status === "down" ? "danger" : "warning"} className="rounded-md px-2 py-0 text-[11px] leading-5">
              {formatStatus(endpoint.status)}
            </UiBadge>
          </div>
        ) : (
          <div className="min-h-5" aria-hidden="true" />
        )}
        <div className="mt-3 space-y-2">
          <HealthValue label="Latency (avg)" value={showEndpoint ? formatLatency(endpoint.latency_ms) : ""} />
          <HealthValue label="Availability (24h)" value="" />
          <HealthValue label="Error rate (24h)" value="" />
        </div>
      </div>
      <Link to="/manager/metrics" className="mt-2.5 inline-flex items-center gap-2 ui-caption font-semibold text-primary">
        View details
        <OpenIcon className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
  return (
    <DashboardUnavailable reason={unavailableReason} className="h-full">
      {content}
    </DashboardUnavailable>
  );
}

function HealthValue({
  label,
  value,
}: {
  label: string;
  value: string;
  unavailableReason?: string | null;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="ui-caption font-medium text-[var(--ui-text)]">{label}</span>
        <span className="ui-caption font-semibold text-[var(--ui-text)]">{value}</span>
      </div>
    </div>
  );
}

function IncidentStrip({
  incidents,
  unavailableReason,
}: {
  incidents: WorkspaceEndpointIncidentEntry[];
  unavailableReason?: string | null;
}) {
  const incident = incidents.find((item) => item.ongoing) ?? incidents[0] ?? null;
  const hasRealIncident = incidents.length > 0 && !unavailableReason;
  const content = (
    <section className={cx(uiCardClass, "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between")}>
      <div className="min-w-0">
        <h2 className="ui-body font-semibold text-[var(--ui-text)]">Ongoing / Recent incidents</h2>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {hasRealIncident && incident ? (
            <>
              <span className="flex items-center gap-2 ui-caption font-semibold text-[var(--ui-text)]">
                <span className={cx("h-2.5 w-2.5 rounded-full", incident.ongoing ? "bg-amber-500" : "bg-emerald-500")} />
                {incident.endpoint_name}
              </span>
              <UiBadge tone={incident.ongoing ? "warning" : "success"} className="rounded-md px-2 py-0 text-[11px] leading-5">
                {incident.ongoing ? "In progress" : "Resolved"}
              </UiBadge>
              <span className={cx("ui-caption", uiMutedTextClass)}>
                {incident.ongoing ? "Ongoing since" : "Resolved"} {formatTimestamp(incident.start)}
              </span>
            </>
          ) : !unavailableReason ? (
            <span className={cx("ui-caption", uiMutedTextClass)}>No ongoing or recent incidents.</span>
          ) : (
            <span className="min-h-4" aria-hidden="true" />
          )}
        </div>
      </div>
      <Link to="/manager/metrics" className="inline-flex shrink-0 items-center gap-2 ui-caption font-semibold text-primary">
        View all incidents
        <OpenIcon className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
  return (
    <DashboardUnavailable reason={unavailableReason} className="h-full">
      {content}
    </DashboardUnavailable>
  );
}

function buildBucketRows(statsRows: Array<{ name: string; used_bytes?: number | null; object_count?: number | null }>): BucketRankingRow[] {
  const rows = statsRows
    .filter((bucket) => bucket.name)
    .map((bucket) => ({
      name: bucket.name,
      storageBytes: bucket.used_bytes ?? null,
      objectCount: bucket.object_count ?? null,
      percent: 0,
    }))
    .sort((left, right) => (right.storageBytes ?? 0) - (left.storageBytes ?? 0))
    .slice(0, 5);
  const maxBytes = Math.max(...rows.map((row) => row.storageBytes ?? 0), 1);
  return rows.map((row) => ({
    ...row,
    percent: Math.max(4, ((row.storageBytes ?? 0) / maxBytes) * 100),
  }));
}

function resolveBucketCount(buckets: Bucket[], fallback?: number | null): number | null {
  if (buckets.length > 0) return buckets.length;
  return fallback ?? null;
}

export default function ManagerDashboard() {
  const { generalSettings } = useGeneralSettings();
  const {
    accounts,
    selectedS3AccountId,
    sessionS3AccountName,
    selectedS3AccountType,
    hasS3AccountContext,
    accountIdForApi,
    accessMode,
    managerStatsEnabled,
    managerStatsMessage,
    managerBrowserEnabled,
  } = useS3AccountContext();
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [workspaceHealthError, setWorkspaceHealthError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketCountLoading, setBucketCountLoading] = useState(false);
  const [bucketCountError, setBucketCountError] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<ManagerActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [trafficStats, setTrafficStats] = useState<ManagerTrafficStats | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficError, setTrafficError] = useState<string | null>(null);

  const selected = useMemo(
    () => accounts.find((account) => account.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const hasContext = hasS3AccountContext;
  const endpointCaps = selected?.storage_endpoint_capabilities ?? null;
  const iamFeatureEnabled = endpointCaps ? endpointCaps.iam !== false : true;
  const contextCanManageIam = selected?.capabilities?.can_manage_iam !== false;
  const usageFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.metrics !== false : true);
  const trafficFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.usage !== false : true);
  const snsFeatureEnabled = endpointCaps ? endpointCaps.sns !== false : true;
  const isS3User = selectedS3AccountType === "s3_user";
  const canManageIam = !isS3User && contextCanManageIam && iamFeatureEnabled;
  const refreshKey = `${accessMode ?? "default"}:${refreshNonce}`;
  const { stats, loading, error } = useManagerStats(
    accountIdForApi,
    usageFeatureEnabled && hasContext,
    refreshKey
  );
  const { overview: iamOverview, loading: iamLoading, error: iamError } = useIamOverview(
    accountIdForApi,
    canManageIam,
    hasContext,
    refreshKey
  );

  useEffect(() => {
    if (!hasContext) {
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      return;
    }
    if (!generalSettings.endpoint_status_enabled) {
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceHealthLoading(true);
    setWorkspaceHealthError(null);
    fetchManagerWorkspaceHealthOverview(accountIdForApi)
      .then((data) => {
        if (cancelled) return;
        setWorkspaceHealth(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkspaceHealth(null);
        setWorkspaceHealthError(extractApiError(err, "Unable to load endpoint health for this account."));
      })
      .finally(() => {
        if (!cancelled) setWorkspaceHealthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.endpoint_status_enabled, hasContext, refreshNonce]);

  useEffect(() => {
    if (!hasContext) {
      setBuckets([]);
      setBucketCountError(null);
      setBucketCountLoading(false);
      return;
    }
    let cancelled = false;
    setBucketCountLoading(true);
    setBucketCountError(null);
    listBuckets(accountIdForApi, { with_stats: false })
      .then((items) => {
        if (cancelled) return;
        setBuckets(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setBuckets([]);
        setBucketCountError(extractApiError(err, "Unable to load bucket count."));
      })
      .finally(() => {
        if (!cancelled) setBucketCountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasContext, refreshNonce]);

  useEffect(() => {
    if (!hasContext) {
      setActivityLogs([]);
      setActivityError(null);
      setActivityLoading(false);
      return;
    }
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    listManagerActivity(accountIdForApi, { limit: 5 })
      .then((items) => {
        if (cancelled) return;
        setActivityLogs(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setActivityLogs([]);
        setActivityError(extractApiError(err, "Unable to load manager activity."));
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasContext, refreshNonce]);

  useEffect(() => {
    if (!hasContext || !trafficFeatureEnabled) {
      setTrafficStats(null);
      setTrafficError(null);
      setTrafficLoading(false);
      return;
    }
    let cancelled = false;
    setTrafficLoading(true);
    setTrafficError(null);
    fetchManagerTraffic(accountIdForApi, "day")
      .then((data) => {
        if (cancelled) return;
        setTrafficStats(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setTrafficStats(null);
        setTrafficError(extractApiError(err, "Unable to load traffic usage."));
      })
      .finally(() => {
        if (!cancelled) setTrafficLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasContext, refreshNonce, trafficFeatureEnabled]);

  const accountLabel = selected
    ? formatAccountLabel(selected, defaultEndpointId, defaultEndpointName)
    : sessionS3AccountName ?? "S3 session";
  const noContextReason = !hasContext ? "Select an account to display live values." : null;
  const metricsUnavailableReason =
    noContextReason ||
    (managerStatsEnabled === null
      ? "Metrics availability is loading for this context."
      : !usageFeatureEnabled
        ? managerStatsMessage || "Storage metrics are not available for this context."
        : error || null);
  const bucketCount = stats?.total_buckets ?? resolveBucketCount(buckets, null);
  const bucketUnavailableReason =
    noContextReason || bucketCountError || (!bucketCountLoading && bucketCount == null ? "Bucket list is not accessible." : null);
  const iamUnavailableReason =
    noContextReason ||
    (canManageIam ? iamError || null : "IAM is disabled for this endpoint or credential.");
  const endpointUnavailableReason =
    noContextReason ||
    (!generalSettings.endpoint_status_enabled
      ? "Endpoint Status feature is disabled."
      : workspaceHealthError ||
        (!workspaceHealthLoading && workspaceHealth && workspaceHealth.endpoint_count === 0
          ? "Endpoint Status has no endpoint data yet."
          : null));
  const activityUnavailableReason = noContextReason || activityError;
  const trafficUnavailableReason = noContextReason || (!trafficFeatureEnabled ? "Traffic usage is not available for this context." : trafficError);
  const storageUsedBytes = metricsUnavailableReason ? null : stats?.total_bytes ?? null;
  const storageQuotaBytes =
    selected?.quota_max_size_gb !== undefined && selected?.quota_max_size_gb !== null
      ? selected.quota_max_size_gb * 1024 ** 3
      : null;
  const objectCount = metricsUnavailableReason ? null : stats?.total_objects ?? null;
  const objectQuota =
    selected?.quota_max_objects !== undefined && selected?.quota_max_objects !== null
      ? selected.quota_max_objects
      : null;
  const visibleBucketCount = bucketUnavailableReason ? null : bucketCount;
  const storagePercent = percent(storageUsedBytes, storageQuotaBytes);
  const uploadBytes = trafficUnavailableReason ? null : trafficStats?.totals.bytes_in ?? null;
  const downloadBytes = trafficUnavailableReason ? null : trafficStats?.totals.bytes_out ?? null;
  const trafficValue =
    uploadBytes == null || downloadBytes == null ? "" : `${formatBytes(uploadBytes)} / ${formatBytes(downloadBytes)}`;
  const bucketRows = buildBucketRows(stats?.bucket_usage ?? []);
  const activityRows = activityUnavailableReason ? [] : buildActivityRows(activityLogs);
  const topBucketsUnavailableReason =
    metricsUnavailableReason ||
    (!loading && visibleBucketCount != null && visibleBucketCount > 0 && bucketRows.length === 0 ? "Bucket storage ranking is not available." : null);
  const healthEndpoint = workspaceHealth?.endpoints[0] ?? null;
  const accessCounts = [
    {
      label: "Users",
      value: iamUnavailableReason ? null : iamOverview?.iam_users ?? stats?.total_iam_users ?? null,
      to: "/manager/users",
      tone: "blue" as DashboardTone,
      icon: <UserIcon className="h-4 w-4" />,
    },
    {
      label: "Groups",
      value: iamUnavailableReason ? null : iamOverview?.iam_groups ?? stats?.total_iam_groups ?? null,
      to: "/manager/groups",
      tone: "emerald" as DashboardTone,
      icon: <GroupIcon className="h-4 w-4" />,
    },
    {
      label: "Roles",
      value: iamUnavailableReason ? null : iamOverview?.iam_roles ?? stats?.total_iam_roles ?? null,
      to: "/manager/roles",
      tone: "amber" as DashboardTone,
      icon: <ShieldIcon className="h-4 w-4" />,
    },
    {
      label: "Policies",
      value: iamUnavailableReason ? null : iamOverview?.iam_policies ?? stats?.total_iam_policies ?? null,
      to: "/manager/iam/policies",
      tone: "violet" as DashboardTone,
      icon: <FileIcon className="h-4 w-4" />,
    },
  ];
  const metrics: DashboardMetric[] = [
    {
      label: "Storage used",
      value: formatOptionalBytes(storageUsedBytes),
      detail: storageQuotaBytes == null ? "" : `${formatBytes(storageQuotaBytes)} quota${storagePercent != null ? ` (${formatPercentage(storagePercent)})` : ""}`,
      progress: storagePercent,
      tone: "blue",
      icon: <BucketIcon className="h-7 w-7" />,
      to: "/manager/metrics",
      unavailableReason: metricsUnavailableReason,
    },
    {
      label: "Buckets",
      value: visibleBucketCount == null ? "" : visibleBucketCount.toLocaleString(),
      detail: visibleBucketCount == null ? "" : "Buckets",
      tone: "emerald",
      icon: <BucketIcon className="h-7 w-7" />,
      to: "/manager/buckets",
      unavailableReason: bucketUnavailableReason,
    },
    {
      label: "Objects",
      value: formatOptionalDashboardNumber(objectCount),
      detail: objectCount == null ? "" : "Objects",
      tone: "violet",
      icon: <FileIcon className="h-7 w-7" />,
      to: "/manager/metrics",
      unavailableReason: metricsUnavailableReason,
    },
    {
      label: "Upload / Download",
      value: trafficLoading ? "..." : trafficValue,
      detail: trafficValue ? "Last 24h" : "",
      tone: "amber",
      icon: <UploadIcon className="h-7 w-7" />,
      to: "/manager/metrics",
      unavailableReason: trafficUnavailableReason,
    },
  ];
  const quickActions: QuickAction[] = [
    {
      label: "Create bucket",
      to: "/manager/buckets",
      tone: "blue",
      icon: <FolderPlusIcon className="h-4 w-4" />,
      unavailableReason: noContextReason,
    },
    {
      label: "Create user",
      to: "/manager/users",
      tone: "blue",
      icon: <UserIcon className="h-4 w-4" />,
      unavailableReason: noContextReason || (!canManageIam ? "IAM is disabled for this context." : null),
    },
    {
      label: "Upload files",
      to: "/manager/browser",
      tone: "emerald",
      icon: <UploadIcon className="h-4 w-4" />,
      unavailableReason:
        noContextReason ||
        (!generalSettings.browser_enabled || !generalSettings.browser_manager_enabled || managerBrowserEnabled === false
          ? "Browser access is disabled for this context."
          : null),
    },
    {
      label: "Manage lifecycle",
      to: "/manager/buckets",
      tone: "amber",
      icon: <HistoryIcon className="h-4 w-4" />,
      unavailableReason: noContextReason,
    },
    {
      label: "Create policy",
      to: "/manager/iam/policies",
      tone: "violet",
      icon: <ShieldIcon className="h-4 w-4" />,
      unavailableReason: noContextReason || (!canManageIam ? "IAM is disabled for this context." : null),
    },
    {
      label: "Create SNS topic",
      to: "/manager/topics",
      tone: "emerald",
      icon: <BellIcon className="h-4 w-4" />,
      unavailableReason: noContextReason || (!snsFeatureEnabled ? "SNS topics are disabled for this endpoint." : null),
    },
  ];
  const refreshing = loading || iamLoading || bucketCountLoading || workspaceHealthLoading || activityLoading || trafficLoading;

  const handleRefresh = () => {
    setLastUpdated(new Date());
    setRefreshNonce((current) => current + 1);
  };

  return (
    <div className="space-y-3" data-testid="manager-dashboard">
      <PageHeader
        title="Manager dashboard"
        description={`Overview of ${accountLabel} storage account and resources.`}
        breadcrumbs={[{ label: "Manager" }, { label: "Dashboard" }]}
        rightContent={
          <div className="flex items-center gap-3">
            <span className={cx("hidden ui-caption sm:inline", uiMutedTextClass)}>
              Updated {formatTimestamp(workspaceHealth?.generated_at ?? lastUpdated)}
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="Refresh manager dashboard"
              title="Refresh"
              className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "h-8 w-8 px-0 py-0")}
              disabled={refreshing}
            >
              <RefreshIcon className={cx("h-4 w-4", refreshing && "animate-spin")} />
            </button>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,1.18fr)_minmax(280px,0.98fr)]">
        <StorageOverviewCard
          usedBytes={storageUsedBytes}
          quotaBytes={storageQuotaBytes}
          unavailableReason={metricsUnavailableReason}
        />
        <TopBucketsCard rows={bucketRows} unavailableReason={topBucketsUnavailableReason} />
        <RecentActivityCard rows={activityRows} loading={activityLoading} unavailableReason={activityUnavailableReason} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.28fr)_minmax(0,0.9fr)_minmax(280px,1fr)]">
        <QuotaStatusCard
          storageUsed={storageUsedBytes}
          storageQuota={storageQuotaBytes}
          objectCount={objectCount}
          objectQuota={objectQuota}
          unavailableReason={metricsUnavailableReason}
        />
        <QuickActionsCard actions={quickActions} />
        <AccessManagementCard counts={accessCounts} unavailableReason={iamUnavailableReason} />
        <BackendHealthCard endpoint={healthEndpoint} unavailableReason={endpointUnavailableReason} />
      </div>

      <IncidentStrip
        incidents={workspaceHealth?.incidents ?? []}
        unavailableReason={endpointUnavailableReason}
      />
    </div>
  );
}

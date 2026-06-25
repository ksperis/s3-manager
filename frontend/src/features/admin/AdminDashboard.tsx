import AdminDashboardMap, { type AdminDashboardMapMarker } from "./components/AdminDashboardMap";
/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listAuditLogs, type AuditLogEntry } from "../../api/audit";
import {
  fetchHealthOverview,
  fetchHealthSummary,
  fetchHealthWorkspaceOverview,
  type EndpointHealthOverviewResponse,
  type HealthCheckStatus,
  type WorkspaceEndpointHealthEntry,
  type WorkspaceEndpointHealthOverviewResponse,
} from "../../api/healthchecks";
import { dismissOnboarding, fetchOnboardingStatus, type OnboardingStatus } from "../../api/onboarding";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import {
  type AdminStorageStats,
  type AdminSummary,
  type AdminTrafficStats,
  fetchAdminStorage,
  fetchAdminSummary,
  fetchAdminTraffic,
} from "../../api/stats";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { adminBreadcrumbs } from "./adminBreadcrumbs";
import {
  type WorkspaceDashboardFeature,
  type WorkspaceDashboardFeatureGroup,
  type WorkspaceDashboardStatCardItem,
  WorkspaceDashboardStatCard,
  WorkspaceDashboardUnavailableFrame,
  WorkspaceFeatureSummaryCard,
  WorkspaceHealthScorePanel,
  type WorkspacePlatformMetric,
  WorkspacePlatformMetricCard,
  WorkspaceStatusDot,
  WorkspaceStatusPill,
  WorkspaceStatusCounter,
} from "../../components/WorkspaceDashboardKit";
import WorkspaceIncidentsCard from "../../components/WorkspaceIncidentsCard";
import UiBadge from "../../components/ui/UiBadge";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiCardClass,
  uiCardMutedClass,
  uiMutedTextClass,
} from "../../components/ui/styles";
import {
  BucketIcon,
  FolderIcon,
  InfoIcon,
  LinkIcon,
  OpenIcon,
  RefreshIcon,
  SettingsIcon,
} from "../browser/browserIcons";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import setupIllustration from "./assets/admin-dashboard-setup.png";

const ENDPOINT_STATUS_MAX_AGE_HOURS = 24;
const ENDPOINT_STATUS_MAX_AGE_MS = ENDPOINT_STATUS_MAX_AGE_HOURS * 60 * 60 * 1000;
const ADMIN_INCIDENT_HISTORY_MINUTES = 7 * 24 * 60;
const MAX_ENDPOINT_ROWS = 6;

function parseBackendIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatTimestamp(value?: string | Date | null): string {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return typeof value === "string" ? value : "-";
  return parsed.toLocaleString();
}

function formatRelativeTime(value?: string | null, now = Date.now()): string {
  const parsed = parseBackendIsoDate(value);
  if (!parsed) return "just now";
  const diffMs = Math.max(0, now - parsed.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isEndpointCheckStale(value?: string | null, now = Date.now()): boolean {
  const parsed = parseBackendIsoDate(value);
  return !parsed || now - parsed.getTime() > ENDPOINT_STATUS_MAX_AGE_MS;
}

function formatEndpointFreshnessWarning(noChecksCount: number, staleCount: number, totalCount: number): string {
  const issueCount = noChecksCount + staleCount;
  const details = [
    noChecksCount > 0 ? `${noChecksCount} without checks` : null,
    staleCount > 0 ? `${staleCount} older than ${ENDPOINT_STATUS_MAX_AGE_HOURS}h` : null,
  ].filter(Boolean);
  return `Endpoint Status uses stored healthcheck samples; ${issueCount}/${totalCount} endpoint(s) need fresh checks (${details.join(
    ", "
  )}). Dashboard statuses may not reflect current availability.`;
}

function formatLatency(value?: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value)} ms`;
}

function formatCheckMode(mode?: string | null): string {
  return (mode || "http").toUpperCase();
}

function computeHealthScore(data?: EndpointHealthOverviewResponse | null): number | null {
  const availabilityValues =
    data?.endpoints
      .map((endpoint) => endpoint.availability_pct)
      .filter((value): value is number => value != null && Number.isFinite(value)) ?? [];
  if (availabilityValues.length === 0) return null;
  const totalAvailability = availabilityValues.reduce((total, value) => total + value, 0);
  return Math.round(totalAvailability / availabilityValues.length);
}

function formatAuditAction(log: AuditLogEntry): string {
  const action = log.action.replace(/[._-]+/g, " ").trim();
  if (log.action.includes("login")) return `User ${log.user_email} logged in`;
  if (log.entity_type === "bucket" && log.entity_id) return `Bucket "${log.entity_id}" ${action}`;
  if (log.entity_type === "endpoint" && log.entity_id) return `Endpoint ${log.entity_id} ${action}`;
  if (log.entity_id) return `${log.entity_type ?? "Entity"} ${log.entity_id} ${action}`;
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function trafficOpsSeries(traffic: AdminTrafficStats | null): number[] {
  return (traffic?.series ?? []).map((point) => point.ops ?? 0).filter((value) => Number.isFinite(value));
}

function formatOptionalBytes(value?: number | null): string {
  return value == null ? "" : formatBytes(value);
}

function formatOptionalCompactNumber(value?: number | null): string {
  return value == null ? "" : formatCompactNumber(value);
}

function OnboardingPanel({
  onboarding,
  error,
  dismissBusy,
  onDismiss,
}: {
  onboarding: OnboardingStatus;
  error: string | null;
  dismissBusy: boolean;
  onDismiss: () => void;
}) {
  return (
    <section className={cx(uiCardClass, "p-4 sm:p-5")}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 w-full flex-1 flex-col gap-4 2xl:flex-row 2xl:items-center">
          <img
            src={setupIllustration}
            alt=""
            className="hidden h-24 w-24 shrink-0 object-contain 2xl:block"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h2 className="ui-subtitle font-semibold text-[var(--ui-text)]">
                  Welcome! Let&apos;s finish your initial setup.
                </h2>
                <p className={cx("mt-1 ui-body", uiMutedTextClass)}>
                  Complete the two base steps below to unlock the rest of the console.
                </p>
              </div>
            </div>
            {error && <p className="mt-3 ui-caption font-semibold text-rose-600 dark:text-rose-300">{error}</p>}
            <div className="mt-4 grid min-w-0 gap-3 xl:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
              <SetupStep
                index={1}
                title="Secure the default admin"
                description="Change the seeded admin email and password so credentials are no longer active."
                done={onboarding.seed_user_configured}
                action={{ label: "Go to UI users", to: "/admin/users" }}
              />
              <SetupStep
                index={2}
                title="Configure a storage endpoint"
                description="Add at least one S3 or Ceph endpoint so the platform can manage accounts and users."
                done={onboarding.endpoint_configured}
                action={{ label: "Configure endpoints", to: "/admin/storage-endpoints" }}
              />
              <div className={cx(uiCardMutedClass, "px-4 py-3 xl:col-span-2 2xl:col-span-1")}>
                <p className="ui-body font-semibold text-[var(--ui-text)]">Next steps</p>
                <div className="mt-3 space-y-2">
                  <Link to="/admin/users" className="flex items-center gap-2 ui-caption font-medium text-primary">
                    <OpenIcon className="h-3.5 w-3.5" /> Add UI user
                  </Link>
                  <Link to="/admin/s3-accounts" className="flex items-center gap-2 ui-caption font-medium text-primary">
                    <OpenIcon className="h-3.5 w-3.5" /> Create account
                  </Link>
                  <Link to="/admin/audit" className="flex items-center gap-2 ui-caption font-medium text-primary">
                    <OpenIcon className="h-3.5 w-3.5" /> View audit trail
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="shrink-0 self-start lg:self-auto">
          <button
            type="button"
            onClick={onDismiss}
            disabled={!onboarding.can_dismiss || dismissBusy}
            className={cx(uiButtonBaseClass, uiButtonVariants.ghost, "px-2 py-1")}
          >
            {dismissBusy ? "Dismissing..." : "Dismiss checklist"}
          </button>
          {!onboarding.can_dismiss && (
            <p className={cx("mt-1 max-w-[13rem] ui-caption lg:text-right", uiMutedTextClass)}>
              Complete pending steps before dismissing.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function SetupStep({
  index,
  title,
  description,
  done,
  action,
}: {
  index: number;
  title: string;
  description: string;
  done: boolean;
  action: { label: string; to: string };
}) {
  return (
    <div className={cx(uiCardMutedClass, "flex min-h-[112px] min-w-0 flex-col justify-between gap-3 px-4 py-3")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <span
            className={cx(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ui-caption font-semibold",
              done
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950 dark:text-emerald-100"
                : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950 dark:text-amber-100"
            )}
          >
            {index}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words ui-body font-semibold text-[var(--ui-text)]">{title}</span>
            <span className={cx("mt-1 block ui-caption", uiMutedTextClass)}>{description}</span>
          </span>
        </div>
        <UiBadge tone={done ? "success" : "warning"} className="shrink-0">{done ? "Done" : "Pending"}</UiBadge>
      </div>
      <Link to={action.to} className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "w-fit px-3 py-1.5")}>
        {action.label}
        <OpenIcon className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function EndpointHealthSection({
  data,
  loading,
  unavailableReason,
  mapMarkers,
  mapLoading,
  mapError,
}: {
  data: WorkspaceEndpointHealthOverviewResponse | null;
  loading: boolean;
  unavailableReason?: string | null;
  mapMarkers: AdminDashboardMapMarker[];
  mapLoading: boolean;
  mapError?: string | null;
}) {
  const content = (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
      <EndpointHealthCard
        data={data}
        loading={loading}
        unavailableReason={unavailableReason}
        mapMarkers={mapMarkers}
        mapLoading={mapLoading}
        mapError={mapError}
      />
      {unavailableReason && !data ? (
        <BlankIncidentsCard />
      ) : (
        <WorkspaceIncidentsCard
          incidents={data?.incidents ?? []}
          loading={loading}
          incidentHighlightMinutes={data?.incident_highlight_minutes}
          action={{ to: "/admin/endpoint-status", label: "View all incidents" }}
          showEmptyState
        />
      )}
    </div>
  );

  if (!unavailableReason) return content;
  return <WorkspaceDashboardUnavailableFrame reason={unavailableReason}>{content}</WorkspaceDashboardUnavailableFrame>;
}

function BlankIncidentsCard() {
  return (
    <section className={cx(uiCardClass, "min-h-[180px] p-4")}>
      <h2 className="ui-body font-semibold text-[var(--ui-text)]">Ongoing / Recent Incidents</h2>
    </section>
  );
}

function EndpointHealthCard({
  data,
  loading,
  unavailableReason,
  mapMarkers,
  mapLoading,
  mapError,
}: {
  data: WorkspaceEndpointHealthOverviewResponse | null;
  loading: boolean;
  unavailableReason?: string | null;
  mapMarkers: AdminDashboardMapMarker[];
  mapLoading: boolean;
  mapError?: string | null;
}) {
  const endpoints = data?.endpoints.slice(0, MAX_ENDPOINT_ROWS) ?? [];
  const staleEndpointCount = data?.endpoints.filter((endpoint) => isEndpointCheckStale(endpoint.checked_at)).length ?? 0;
  return (
    <section className={cx(uiCardClass, "min-w-0 p-4")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="ui-body font-semibold text-[var(--ui-text)]">Endpoint Health</h2>
          <p className={cx("ui-caption", uiMutedTextClass)}>Stored healthcheck samples and latency.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={cx("ui-caption", uiMutedTextClass)}>Data refreshed {data ? formatTimestamp(data.generated_at) : "-"}</span>
          {staleEndpointCount > 0 && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 ui-caption font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-100">
              {staleEndpointCount} stale check{staleEndpointCount === 1 ? "" : "s"}
            </span>
          )}
          <Link to="/admin/endpoint-status" className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "px-2.5 py-1.5")}>
            Open Endpoint Status
          </Link>
        </div>
      </div>

      {loading ? (
        <div className={cx(uiCardMutedClass, "mt-4 h-48 animate-pulse")} />
      ) : (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <WorkspaceStatusCounter label="Up" value={unavailableReason ? null : data?.up_count} status="up" />
            <WorkspaceStatusCounter label="Degraded" value={unavailableReason ? null : data?.degraded_count} status="degraded" />
            <WorkspaceStatusCounter label="Down" value={unavailableReason ? null : data?.down_count} status="down" />
            <WorkspaceStatusCounter label="Unknown" value={unavailableReason ? null : data?.unknown_count} status="unknown" />
          </div>
          <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-1.5">
              {endpoints.length === 0 && !unavailableReason ? (
                <p className={cx("ui-caption", uiMutedTextClass)}>No endpoint linked to this workspace context.</p>
              ) : (
                endpoints.map((endpoint) => (
                  <EndpointRow key={endpoint.endpoint_id} endpoint={endpoint} />
                ))
              )}
              {(data?.endpoints.length ?? 0) > MAX_ENDPOINT_ROWS && (
                <p className="ui-caption font-medium text-primary">+ {(data?.endpoints.length ?? 0) - MAX_ENDPOINT_ROWS} more endpoint(s)</p>
              )}
            </div>
            {!unavailableReason && (
              <AdminDashboardMap markers={mapMarkers} loading={mapLoading} error={mapError} />
            )}
          </div>
        </>
      )}
    </section>
  );
}

function EndpointRow({ endpoint }: { endpoint: WorkspaceEndpointHealthEntry }) {
  const stale = isEndpointCheckStale(endpoint.checked_at);
  const checkedAtLabel = endpoint.checked_at ? `Checked ${formatRelativeTime(endpoint.checked_at)}` : "No healthcheck yet";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-[color:var(--ui-border-soft)] px-2 py-2 ui-caption sm:grid sm:grid-cols-[minmax(0,1fr)_64px_60px_minmax(108px,1fr)_auto] sm:border-0 sm:px-0 sm:py-0">
      <span className="flex min-w-0 items-center gap-2 font-semibold text-[var(--ui-text)]">
        <WorkspaceStatusDot status={endpoint.status} className="shrink-0" />
        <span className="truncate">{endpoint.name}</span>
      </span>
      <span className={uiMutedTextClass}>{formatLatency(endpoint.latency_ms)}</span>
      <span className={uiMutedTextClass}>{formatCheckMode(endpoint.check_mode)}</span>
      <span
        className={cx(
          "min-w-0 truncate",
          stale ? "font-semibold text-amber-700 dark:text-amber-100" : uiMutedTextClass
        )}
        title={formatTimestamp(endpoint.checked_at)}
      >
        {checkedAtLabel}
      </span>
      <WorkspaceStatusPill status={endpoint.status} />
    </div>
  );
}

function PlatformSummary({
  storage,
  storageLoading,
  storageError,
  traffic,
  trafficLoading,
  trafficError,
  healthScore,
  healthScoreLoading,
  healthScoreUnavailableReason,
}: {
  storage: AdminStorageStats | null;
  storageLoading: boolean;
  storageError: string | null;
  traffic: AdminTrafficStats | null;
  trafficLoading: boolean;
  trafficError: string | null;
  healthScore: number | null;
  healthScoreLoading: boolean;
  healthScoreUnavailableReason?: string | null;
}) {
  const storageTotals = storage?.storage_totals;
  const requestsSeries = trafficOpsSeries(traffic);
  const storageReason = storageError || (!storageLoading && !storage ? "Storage metrics are not available." : undefined);
  const trafficReason = trafficError || (!trafficLoading && !traffic ? "Usage logs are not available." : undefined);
  const metrics: WorkspacePlatformMetric[] = [
    {
      label: "Buckets",
      value: storageLoading ? "..." : formatOptionalCompactNumber(storageReason ? null : storageTotals?.bucket_count ?? storage?.total_buckets ?? null),
      tone: "blue",
      unavailableReason: storageReason || "Trend unavailable",
    },
    {
      label: "Objects",
      value: storageLoading ? "..." : formatOptionalCompactNumber(storageReason ? null : storageTotals?.object_count ?? null),
      tone: "violet",
      unavailableReason: storageReason || "Trend unavailable",
    },
    {
      label: "Stored data",
      value: storageLoading ? "..." : formatOptionalBytes(storageReason ? null : storageTotals?.used_bytes ?? null),
      tone: "emerald",
      unavailableReason: storageReason || "Trend unavailable",
    },
    {
      label: "Requests (24h)",
      value: trafficLoading ? "..." : formatOptionalCompactNumber(trafficReason ? null : traffic?.totals.ops ?? null),
      delta: trafficReason ? undefined : traffic?.totals.success_rate != null ? `${formatPercentage(traffic.totals.success_rate * 100)} success` : undefined,
      series: requestsSeries.length > 0 ? requestsSeries : undefined,
      tone: "blue",
      unavailableReason: trafficReason || (requestsSeries.length === 0 && !trafficLoading ? "Trend unavailable" : undefined),
    },
  ];

  return (
    <section className={cx(uiCardClass, "px-4 py-3")}>
      <h2 className="ui-section text-[var(--ui-text)]">Platform summary</h2>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_116px]">
        <div className="grid gap-y-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-y-0">
          {metrics.map((metric) => (
            <WorkspacePlatformMetricCard key={metric.label} metric={metric} />
          ))}
        </div>
        <div className="border-t border-[color:var(--ui-border-soft)] pt-3 xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
          <WorkspaceHealthScorePanel score={healthScore} loading={healthScoreLoading} unavailableReason={healthScoreUnavailableReason} />
        </div>
      </div>
    </section>
  );
}

function RecentActivityCard({
  logs,
  loading,
  unavailableReason,
}: {
  logs: AuditLogEntry[];
  loading: boolean;
  unavailableReason?: string | null;
}) {
  const displayLogs = unavailableReason ? [] : logs;
  const content = (
    <section className={cx(uiCardClass, "h-full p-4")}>
      <h2 className="ui-body font-semibold text-[var(--ui-text)]">Recent activity</h2>
      {loading ? (
        <div className="mt-4 space-y-3">
          {[1, 2, 3].map((key) => (
            <div key={key} className={cx(uiCardMutedClass, "h-8 animate-pulse")} />
          ))}
        </div>
      ) : displayLogs.length === 0 && !unavailableReason ? (
        <div className={cx(uiCardMutedClass, "mt-4 border-dashed px-3 py-6 text-center ui-caption", uiMutedTextClass)}>
          No recent audit activity.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {displayLogs.slice(0, 3).map((log) => (
            <li key={log.id} className="flex items-start justify-between gap-4 ui-caption">
              <span className="flex min-w-0 items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <span className="min-w-0 truncate text-[var(--ui-text)]">{formatAuditAction(log)}</span>
              </span>
              <span className={cx("shrink-0", uiMutedTextClass)}>{formatRelativeTime(log.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/admin/audit" className="mt-5 inline-flex items-center gap-2 ui-caption font-semibold text-primary">
        View audit logs
        <OpenIcon className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
  if (!unavailableReason) return content;
  return <WorkspaceDashboardUnavailableFrame reason={unavailableReason} className="h-full">{content}</WorkspaceDashboardUnavailableFrame>;
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [endpointFreshnessWarning, setEndpointFreshnessWarning] = useState<string | null>(null);
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [workspaceHealthError, setWorkspaceHealthError] = useState<string | null>(null);
  const [mapEndpoints, setMapEndpoints] = useState<StorageEndpoint[]>([]);
  const [mapEndpointsLoading, setMapEndpointsLoading] = useState(false);
  const [mapEndpointsError, setMapEndpointsError] = useState<string | null>(null);
  const [healthOverview, setHealthOverview] = useState<EndpointHealthOverviewResponse | null>(null);
  const [healthOverviewLoading, setHealthOverviewLoading] = useState(false);
  const [healthOverviewError, setHealthOverviewError] = useState<string | null>(null);
  const [storage, setStorage] = useState<AdminStorageStats | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<AdminTrafficStats | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [dismissBusy, setDismissBusy] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { generalSettings } = useGeneralSettings();

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    fetchAdminSummary()
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setSummaryError(null);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setSummary(null);
        setSummaryError(extractApiError(err, "Unable to load admin overview."));
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    fetchOnboardingStatus()
      .then((data) => {
        if (cancelled) return;
        setOnboarding(data);
        setOnboardingError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setOnboardingError(extractApiError(err, "Unable to load onboarding status."));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setStorageLoading(true);
    setStorageError(null);
    fetchAdminStorage()
      .then((data) => {
        if (cancelled) return;
        setStorage(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setStorage(null);
        setStorageError(extractApiError(err, "Storage metrics are not available."));
      })
      .finally(() => {
        if (!cancelled) setStorageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setTrafficLoading(true);
    setTrafficError(null);
    fetchAdminTraffic("day")
      .then((data) => {
        if (cancelled) return;
        setTraffic(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setTraffic(null);
        setTrafficError(extractApiError(err, "Usage logs are not available."));
      })
      .finally(() => {
        if (!cancelled) setTrafficLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setAuditLoading(true);
    setAuditError(null);
    listAuditLogs({ limit: 3 })
      .then((data) => {
        if (cancelled) return;
        setAuditLogs(data.logs ?? []);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setAuditLogs([]);
        setAuditError(extractApiError(err, "Audit activity is not available."));
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) {
      setEndpointFreshnessWarning(null);
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      setHealthOverview(null);
      setHealthOverviewError(null);
      setHealthOverviewLoading(false);
      return;
    }
    let cancelled = false;
    const verifyEndpointStatusFreshness = async () => {
      try {
        const data = await fetchHealthSummary();
        if (cancelled) return;
        const endpoints = data.endpoints ?? [];
        if (endpoints.length === 0) {
          setEndpointFreshnessWarning("Endpoint Status is enabled, but no endpoint healthcheck data is available.");
          return;
        }
        const now = Date.now();
        let noChecksCount = 0;
        let staleCount = 0;
        for (const endpoint of endpoints) {
          if ((endpoint.error_message ?? "").toLowerCase().includes("no checks yet")) {
            noChecksCount += 1;
            continue;
          }
          const checkedAt = parseBackendIsoDate(endpoint.checked_at);
          if (!checkedAt || now - checkedAt.getTime() > ENDPOINT_STATUS_MAX_AGE_MS) {
            staleCount += 1;
          }
        }
        if (noChecksCount > 0 || staleCount > 0) {
          setEndpointFreshnessWarning(formatEndpointFreshnessWarning(noChecksCount, staleCount, endpoints.length));
          return;
        }
        setEndpointFreshnessWarning(null);
      } catch {
        if (!cancelled) {
          setEndpointFreshnessWarning("Endpoint Status is enabled, but freshness could not be verified.");
        }
      }
    };
    verifyEndpointStatusFreshness();
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, refreshNonce]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) return;
    let cancelled = false;
    setWorkspaceHealthLoading(true);
    setWorkspaceHealthError(null);
    fetchHealthWorkspaceOverview(undefined, ADMIN_INCIDENT_HISTORY_MINUTES)
      .then((data) => {
        if (cancelled) return;
        setWorkspaceHealth(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkspaceHealth(null);
        setWorkspaceHealthError(extractApiError(err, "Unable to load workspace endpoint health."));
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceHealthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, refreshNonce]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) {
      setMapEndpoints([]);
      setMapEndpointsError(null);
      setMapEndpointsLoading(false);
      return;
    }
    let cancelled = false;
    setMapEndpointsLoading(true);
    setMapEndpointsError(null);
    listStorageEndpoints()
      .then((data) => {
        if (cancelled) return;
        setMapEndpoints(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setMapEndpoints([]);
        setMapEndpointsError(extractApiError(err, "Unable to load endpoint map coordinates."));
      })
      .finally(() => {
        if (!cancelled) {
          setMapEndpointsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, refreshNonce]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) return;
    let cancelled = false;
    setHealthOverviewLoading(true);
    setHealthOverviewError(null);
    fetchHealthOverview("week")
      .then((data) => {
        if (cancelled) return;
        setHealthOverview(data);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setHealthOverview(null);
        setHealthOverviewError(extractApiError(err, "7-day endpoint health history is not available."));
      })
      .finally(() => {
        if (!cancelled) {
          setHealthOverviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, refreshNonce]);

  const handleDismissOnboarding = async () => {
    if (!onboarding?.can_dismiss) return;
    setDismissBusy(true);
    try {
      const data = await dismissOnboarding();
      setOnboarding(data);
    } catch (err) {
      setOnboardingError(extractApiError(err, "Unable to dismiss onboarding yet."));
    } finally {
      setDismissBusy(false);
    }
  };

  const coreFeatures = useMemo<WorkspaceDashboardFeature[]>(
    () => [
      { id: "manager", label: "Manager", enabled: generalSettings.manager_enabled },
      { id: "browser", label: "Browser", enabled: generalSettings.browser_enabled },
      { id: "portal", label: "Portal", enabled: generalSettings.portal_enabled },
      { id: "ceph_admin", label: "Ceph Admin", enabled: generalSettings.ceph_admin_enabled, massManagement: true },
      { id: "storage_ops", label: "Storage Ops", enabled: generalSettings.storage_ops_enabled, massManagement: true },
    ],
    [
      generalSettings.browser_enabled,
      generalSettings.ceph_admin_enabled,
      generalSettings.manager_enabled,
      generalSettings.portal_enabled,
      generalSettings.storage_ops_enabled,
    ]
  );

  const extraFeatures = useMemo<WorkspaceDashboardFeature[]>(
    () => [
      { id: "billing", label: "Billing", enabled: generalSettings.billing_enabled },
      { id: "endpoint_status", label: "Endpoint Status", enabled: generalSettings.endpoint_status_enabled },
      { id: "quota_alerts", label: "Quota alerts", enabled: generalSettings.quota_alerts_enabled },
      { id: "usage_history", label: "Usage history", enabled: generalSettings.usage_history_enabled },
    ],
    [
      generalSettings.billing_enabled,
      generalSettings.endpoint_status_enabled,
      generalSettings.quota_alerts_enabled,
      generalSettings.usage_history_enabled,
    ]
  );

  const featureGroups = useMemo<WorkspaceDashboardFeatureGroup[]>(
    () => [
      { title: "Core features", features: coreFeatures },
      { title: "Extra features", features: extraFeatures },
    ],
    [coreFeatures, extraFeatures]
  );

  const statCards = useMemo<WorkspaceDashboardStatCardItem[]>(() => {
    const totalUiUsers = (summary?.total_users ?? 0) + (summary?.total_admins ?? 0) + (summary?.total_none_users ?? 0);
    return [
      {
        id: "ui-users",
        label: "UI Users",
        value: totalUiUsers,
        hint: `Admins: ${summary?.total_admins ?? 0}  Users: ${summary?.total_users ?? 0}`,
        to: "/admin/users",
        tone: "indigo",
        icon: <InfoIcon className="h-5 w-5" />,
      },
      {
        id: "accounts-primary",
        label: "Accounts",
        value: summary?.total_accounts ?? 0,
        hint: `Assigned: ${summary?.assigned_accounts ?? 0}`,
        to: "/admin/s3-accounts",
        tone: "amber",
        icon: <FolderIcon className="h-5 w-5" />,
      },
      {
        id: "s3-users",
        label: "S3 Users",
        value: summary?.total_s3_users ?? 0,
        hint: `Assigned: ${summary?.assigned_s3_users ?? 0}`,
        to: "/admin/s3-users",
        tone: "emerald",
        icon: <SettingsIcon className="h-5 w-5" />,
      },
      {
        id: "shared-s3-connections",
        label: "Shared S3 Connections",
        value: summary?.total_shared_connections ?? 0,
        hint: "Admin-managed",
        to: "/admin/s3-connections",
        tone: "violet",
        icon: <LinkIcon className="h-5 w-5" />,
      },
      {
        id: "endpoints",
        label: "Endpoints",
        value: summary?.total_endpoints ?? 0,
        hint: `Ceph: ${summary?.total_ceph_endpoints ?? 0}  Other: ${summary?.total_other_endpoints ?? 0}`,
        to: "/admin/storage-endpoints",
        tone: "blue",
        icon: <BucketIcon className="h-5 w-5" />,
      },
    ];
  }, [summary]);

  const mapMarkers = useMemo<AdminDashboardMapMarker[]>(() => {
    const statusByEndpointId = new Map<number, HealthCheckStatus>();
    workspaceHealth?.endpoints.forEach((endpoint) => {
      statusByEndpointId.set(endpoint.endpoint_id, endpoint.status);
    });
    return mapEndpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      latitude: endpoint.latitude,
      longitude: endpoint.longitude,
      status: statusByEndpointId.get(endpoint.id) ?? "unknown",
    }));
  }, [mapEndpoints, workspaceHealth]);

  const endpointUnavailableReason = !generalSettings.endpoint_status_enabled
    ? "Endpoint Status feature is disabled."
    : workspaceHealthError
      ? workspaceHealthError
      : !workspaceHealthLoading && workspaceHealth && workspaceHealth.endpoint_count === 0
        ? "Endpoint Status has no endpoint data yet."
        : null;
  const healthScore = computeHealthScore(healthOverview);
  const healthScoreUnavailableReason =
    endpointUnavailableReason ||
    healthOverviewError ||
    (healthScore == null && !healthOverviewLoading ? "7-day endpoint health history is not available." : null);
  const refreshing =
    summaryLoading ||
    storageLoading ||
    trafficLoading ||
    auditLoading ||
    workspaceHealthLoading ||
    healthOverviewLoading ||
    mapEndpointsLoading;

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden" data-testid="admin-dashboard">
      <PageHeader
        title="Admin overview"
        description="Monitor the health and status of your S3 infrastructure."
        breadcrumbs={adminBreadcrumbs({ label: "Dashboard" })}
        rightContent={
          <div className="flex items-center gap-3">
            <span className={cx("hidden ui-caption sm:inline", uiMutedTextClass)}>
              Updated {lastUpdated ? formatTimestamp(lastUpdated) : "-"}
            </span>
            <button
              type="button"
              onClick={() => setRefreshNonce((current) => current + 1)}
              aria-label="Refresh admin dashboard"
              title="Refresh"
              className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "h-8 w-8 px-0 py-0")}
              disabled={refreshing}
            >
              <RefreshIcon className={cx("h-4 w-4", refreshing && "animate-spin")} />
            </button>
          </div>
        }
      />

      {onboarding && !onboarding.dismissed && (
        <OnboardingPanel
          onboarding={onboarding}
          error={onboardingError}
          dismissBusy={dismissBusy}
          onDismiss={handleDismissOnboarding}
        />
      )}

      {endpointFreshnessWarning && <PageBanner tone="warning">{endpointFreshnessWarning}</PageBanner>}
      {summaryError && <PageBanner tone="error">{summaryError}</PageBanner>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {statCards.map((card) => (
          <WorkspaceDashboardStatCard key={card.id} card={card} loading={summaryLoading} />
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {featureGroups.map((group) => (
          <WorkspaceFeatureSummaryCard key={group.title} group={group} />
        ))}
      </div>

      <EndpointHealthSection
        data={workspaceHealth}
        loading={workspaceHealthLoading}
        unavailableReason={endpointUnavailableReason}
        mapMarkers={mapMarkers}
        mapLoading={mapEndpointsLoading}
        mapError={mapEndpointsError}
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)]">
        <PlatformSummary
          storage={storage}
          storageLoading={storageLoading}
          storageError={storageError}
          traffic={traffic}
          trafficLoading={trafficLoading}
          trafficError={trafficError}
          healthScore={healthScore}
          healthScoreLoading={healthOverviewLoading}
          healthScoreUnavailableReason={healthScoreUnavailableReason}
        />
        <RecentActivityCard
          logs={auditLogs}
          loading={auditLoading}
          unavailableReason={auditError}
        />
      </div>
    </div>
  );
}

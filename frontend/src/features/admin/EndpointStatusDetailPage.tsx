/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  EndpointHealthIncident,
  EndpointHealthRawCheck,
  EndpointHealthSeries,
  EndpointHealthSummary,
  fetchHealthIncidents,
  fetchHealthRawChecks,
  fetchHealthSeries,
  fetchHealthSummary,
  runHealthchecks,
} from "../../api/healthchecks";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import ListSectionCard from "../../components/list/ListSectionCard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  buildTimelineSegmentDetails,
  EndpointTimelineBar,
  formatChartDay,
  formatChartTime,
  formatCheckMode,
  formatDurationShort,
  formatLatency,
  formatPercent,
  formatTimestamp,
  statusTextClass,
  STATUS_LABELS,
  StatusPill,
  toTimestampMs,
} from "./endpointStatusShared";
import {
  buildLatencyChartPoints,
  buildLatencyStatusBands,
  downsampleLatencySeries,
  type LatencyChartPoint,
} from "./endpointStatusLatencyChart";

type WindowOption = { label: string; value: "day" | "week" | "month" | "quarter" | "half_year"; helper: string };

const WINDOW_OPTIONS: WindowOption[] = [
  { label: "24h", value: "day", helper: "Last 24 hours" },
  { label: "7d", value: "week", helper: "Last 7 days" },
  { label: "30d", value: "month", helper: "Last 30 days" },
  { label: "90d", value: "quarter", helper: "Last 90 days" },
  { label: "6m", value: "half_year", helper: "Last 6 months" },
];
const RAW_CHECKS_PAGE_SIZE = 25;

export default function EndpointStatusDetailPage() {
  const params = useParams();
  const endpointId = Number(params.endpointId ?? "");
  const hasValidEndpointId = Number.isFinite(endpointId) && endpointId > 0;

  const [summary, setSummary] = useState<EndpointHealthSummary[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [windowValue, setWindowValue] = useState<WindowOption["value"]>("week");

  const [series, setSeries] = useState<EndpointHealthSeries | null>(null);
  const [seriesLoading, setSeriesLoading] = useState<boolean>(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const [incidents, setIncidents] = useState<EndpointHealthIncident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState<boolean>(false);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const [rawChecks, setRawChecks] = useState<EndpointHealthRawCheck[]>([]);
  const [rawChecksTotal, setRawChecksTotal] = useState<number>(0);
  const [rawChecksPage, setRawChecksPage] = useState<number>(1);
  const [rawChecksLoading, setRawChecksLoading] = useState<boolean>(false);
  const [rawChecksError, setRawChecksError] = useState<string | null>(null);
  const [selectedTimelineSegmentKey, setSelectedTimelineSegmentKey] = useState<string | null>(null);

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState<boolean>(false);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const payload = await fetchHealthSummary();
      setSummary(payload.endpoints ?? []);
    } catch {
      setSummary([]);
      setSummaryError("Unable to load endpoint summary.");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadDetails = useCallback(async (selectedEndpointId: number, window: WindowOption["value"]) => {
    setSeriesLoading(true);
    setSeriesError(null);
    setIncidentsLoading(true);
    setIncidentsError(null);
    try {
      const [seriesData, incidentsData] = await Promise.all([
        fetchHealthSeries(selectedEndpointId, window),
        fetchHealthIncidents(selectedEndpointId, window),
      ]);
      setSeries(seriesData);
      setIncidents(incidentsData.incidents ?? []);
    } catch {
      setSeries(null);
      setIncidents([]);
      setSeriesError("Unable to load endpoint series.");
      setIncidentsError("Unable to load endpoint incidents.");
    } finally {
      setSeriesLoading(false);
      setIncidentsLoading(false);
    }
  }, []);

  const loadRawChecks = useCallback(
    async (selectedEndpointId: number, window: WindowOption["value"], page: number) => {
      setRawChecksLoading(true);
      setRawChecksError(null);
      try {
        const payload = await fetchHealthRawChecks(selectedEndpointId, window, page, RAW_CHECKS_PAGE_SIZE);
        setRawChecks(payload.checks ?? []);
        setRawChecksTotal(payload.total ?? 0);
      } catch {
        setRawChecks([]);
        setRawChecksTotal(0);
        setRawChecksError("Unable to load raw healthchecks.");
      } finally {
        setRawChecksLoading(false);
      }
    },
    []
  );

  const loadAll = useCallback(async () => {
    if (!hasValidEndpointId) return;
    await Promise.all([loadSummary(), loadDetails(endpointId, windowValue), loadRawChecks(endpointId, windowValue, rawChecksPage)]);
  }, [endpointId, hasValidEndpointId, loadDetails, loadRawChecks, loadSummary, rawChecksPage, windowValue]);

  const handleRunNow = useCallback(async () => {
    if (runLoading || !hasValidEndpointId) return;
    setRunLoading(true);
    setActionMessage(null);
    setActionError(null);
    try {
      await runHealthchecks();
      setActionMessage("Healthchecks executed.");
      await loadAll();
    } catch {
      setActionError("Unable to run healthchecks.");
    } finally {
      setRunLoading(false);
    }
  }, [hasValidEndpointId, loadAll, runLoading]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!hasValidEndpointId) {
      setSeries(null);
      setIncidents([]);
      setRawChecks([]);
      setRawChecksTotal(0);
      return;
    }
    loadDetails(endpointId, windowValue);
  }, [endpointId, hasValidEndpointId, loadDetails, windowValue]);

  useEffect(() => {
    if (!hasValidEndpointId) return;
    loadRawChecks(endpointId, windowValue, rawChecksPage);
  }, [endpointId, hasValidEndpointId, loadRawChecks, rawChecksPage, windowValue]);

  useEffect(() => {
    setRawChecksPage(1);
  }, [endpointId]);

  const selectedEndpoint = useMemo(() => {
    return summary?.find((entry) => entry.endpoint_id === endpointId) ?? null;
  }, [endpointId, summary]);

  const latencyChartData = useMemo(() => buildLatencyChartPoints(series, windowValue), [series, windowValue]);
  const latencyDisplayMode = latencyChartData.mode;
  const latencyPoints = latencyChartData.points;

  const latencySeries = useMemo(
    () => downsampleLatencySeries(latencyPoints, windowValue === "day" ? 900 : 1200),
    [latencyPoints, windowValue]
  );

  const latencyRangeStartMs = useMemo(() => toTimestampMs(series?.start ?? ""), [series?.start]);
  const latencyRangeEndMs = useMemo(() => toTimestampMs(series?.end ?? ""), [series?.end]);

  const latencyStatusBands = useMemo(
    () =>
      buildLatencyStatusBands(latencyPoints, {
        rangeStartMs: latencyRangeStartMs,
        rangeEndMs: latencyRangeEndMs,
      }),
    [latencyPoints, latencyRangeEndMs, latencyRangeStartMs]
  );

  const windowAvailability = useMemo(() => {
    if (!series) return null;
    if (latencyDisplayMode === "rollup") {
      const knownStatuses = series.series.filter((point) => point.status !== "unknown");
      if (knownStatuses.length === 0) return null;
      const upChecks = knownStatuses.filter((point) => point.status === "up").length;
      return (upChecks / knownStatuses.length) * 100;
    }
    const totals = series.daily.reduce(
      (acc, point) => {
        acc.ok += point.ok_count;
        acc.total += point.ok_count + point.degraded_count + point.down_count;
        return acc;
      },
      { ok: 0, total: 0 }
    );
    if (totals.total === 0) return null;
    return (totals.ok / totals.total) * 100;
  }, [latencyDisplayMode, series]);

  const windowAverageLatency = useMemo(() => {
    const values = latencyPoints.map((point) => point.latency_ms).filter((value): value is number => value != null);
    if (values.length === 0) return null;
    return Math.round(values.reduce((acc, value) => acc + value, 0) / values.length);
  }, [latencyPoints]);

  const windowP95Latency = useMemo(() => {
    if (!series) return null;
    const p95Values = series.daily.map((point) => point.p95_latency_ms).filter((value): value is number => value != null);
    if (p95Values.length === 0) return null;
    return Math.round(p95Values.reduce((acc, value) => acc + value, 0) / p95Values.length);
  }, [series]);

  const latencyXAxisDomain = useMemo<[number, number]>(() => {
    if (latencyRangeStartMs != null && latencyRangeEndMs != null && latencyRangeEndMs > latencyRangeStartMs) {
      return [latencyRangeStartMs, latencyRangeEndMs];
    }
    if (latencyPoints.length === 0) return [0, 1];
    const timestamps = latencyPoints.map((point) => point.timestampMs);
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    if (minTs === maxTs) {
      const padMs = windowValue === "day" ? 30 * 60 * 1000 : 12 * 60 * 60 * 1000;
      return [minTs - padMs, maxTs + padMs];
    }
    return [minTs, maxTs];
  }, [latencyPoints, latencyRangeEndMs, latencyRangeStartMs, windowValue]);

  const latencySamplesCount = useMemo(
    () => latencyPoints.filter((point) => point.latency_ms != null).length,
    [latencyPoints]
  );

  const latencyXAxisTickCount = useMemo(() => {
    if (windowValue === "day") return 8;
    if (windowValue === "week") return 8;
    return 6;
  }, [windowValue]);

  const latencyXAxisMinTickGap = useMemo(() => {
    if (windowValue === "day") return 28;
    if (windowValue === "week") return 36;
    return 44;
  }, [windowValue]);

  const formatLatencyTick = useCallback(
    (value: number) => (latencyDisplayMode === "rollup" ? formatChartTime(value) : formatChartDay(value)),
    [latencyDisplayMode]
  );

  const renderLatencyTooltip = useCallback(
    ({
      active,
      payload,
      label,
    }: {
      active?: boolean;
      payload?: Array<{ payload: LatencyChartPoint }>;
      label?: number;
    }) => {
      if (!active || !payload || payload.length === 0) return null;
      const point = payload[0]?.payload;
      if (!point) return null;
      const statusLabel = STATUS_LABELS[point.status];
      const missingLatencyMessage =
        point.latency_ms == null && (point.status === "down" || point.status === "degraded")
          ? "No latency sample during outage/degradation."
          : null;

      return (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
            {typeof label === "number" ? formatLatencyTick(label) : "-"}
          </p>
          <p className="ui-caption text-slate-600 dark:text-slate-300">
            Status: <span className={`font-semibold ${statusTextClass(point.status)}`}>{statusLabel}</span>
          </p>
          <p className="ui-caption text-slate-600 dark:text-slate-300">
            {latencyDisplayMode === "rollup" ? "Rollup latency" : "Average latency"}:{" "}
            <span className="font-semibold">{formatLatency(point.latency_ms)}</span>
          </p>
          {latencyDisplayMode === "daily" && (
            <p className="ui-caption text-slate-600 dark:text-slate-300">
              P95 latency: <span className="font-semibold">{formatLatency(point.p95_latency_ms)}</span>
            </p>
          )}
          {missingLatencyMessage && <p className="ui-caption text-slate-500 dark:text-slate-400">{missingLatencyMessage}</p>}
        </div>
      );
    },
    [formatLatencyTick, latencyDisplayMode]
  );

  const rawChecksTotalPages = useMemo(() => {
    if (rawChecksTotal <= 0) return 1;
    return Math.max(1, Math.ceil(rawChecksTotal / RAW_CHECKS_PAGE_SIZE));
  }, [rawChecksTotal]);
  const rawChecksTableStatus = resolveListTableStatus({
    loading: rawChecksLoading,
    error: rawChecksError,
    rowCount: rawChecks.length,
  });
  const incidentsTableStatus = resolveListTableStatus({
    loading: incidentsLoading,
    error: incidentsError,
    rowCount: incidents.length,
  });

  useEffect(() => {
    if (rawChecksPage > rawChecksTotalPages) {
      setRawChecksPage(rawChecksTotalPages);
    }
  }, [rawChecksPage, rawChecksTotalPages]);

  const timelineSegments = useMemo(
    () => buildTimelineSegmentDetails(series?.series ?? [], series?.start, series?.end),
    [series]
  );

  const selectedTimelineSegment = useMemo(
    () => timelineSegments.find((segment) => segment.key === selectedTimelineSegmentKey) ?? null,
    [selectedTimelineSegmentKey, timelineSegments]
  );

  useEffect(() => {
    if (timelineSegments.length === 0) {
      setSelectedTimelineSegmentKey(null);
      return;
    }
    if (!selectedTimelineSegmentKey) return;
    const stillExists = timelineSegments.some((segment) => segment.key === selectedTimelineSegmentKey);
    if (!stillExists) {
      setSelectedTimelineSegmentKey(timelineSegments[0].key);
    }
  }, [selectedTimelineSegmentKey, timelineSegments]);

  useEffect(() => {
    if (!selectedTimelineSegmentKey || timelineSegments.length === 0) return;
    const handleArrowNavigation = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }
      const currentIndex = timelineSegments.findIndex((segment) => segment.key === selectedTimelineSegmentKey);
      if (currentIndex < 0) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + timelineSegments.length) % timelineSegments.length;
      setSelectedTimelineSegmentKey(timelineSegments[nextIndex].key);
    };
    window.addEventListener("keydown", handleArrowNavigation);
    return () => {
      window.removeEventListener("keydown", handleArrowNavigation);
    };
  }, [selectedTimelineSegmentKey, timelineSegments]);

  if (!hasValidEndpointId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Endpoint Details"
          breadcrumbs={[{ label: "Admin" }, { label: "Connectivity" }, { label: "Endpoint Status", to: "/admin/endpoint-status" }, { label: "Details" }]}
          actions={[{ label: "Back", to: "/admin/endpoint-status", variant: "ghost" }]}
        />
        <PageBanner tone="warning">Invalid endpoint identifier.</PageBanner>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={selectedEndpoint ? selectedEndpoint.name : "Endpoint Details"}
        description={selectedEndpoint?.endpoint_url || "Detailed health history and incidents for one endpoint."}
        breadcrumbs={[
          { label: "Admin" },
          { label: "Connectivity" },
          { label: "Endpoint Status", to: "/admin/endpoint-status" },
          { label: "Details" },
        ]}
        actions={[
          { label: runLoading ? "Running..." : "Check now", onClick: handleRunNow },
          { label: "Refresh", onClick: loadAll, variant: "ghost" },
          { label: "Back", to: "/admin/endpoint-status", variant: "ghost" },
        ]}
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {summaryError && <PageBanner tone="error">{summaryError}</PageBanner>}
      {seriesError && <PageBanner tone="error">{seriesError}</PageBanner>}

      <div className="ui-surface-card">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Health detail</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Mode {formatCheckMode(series?.check_mode ?? selectedEndpoint?.check_mode)}
              {series?.check_target_url ? ` · Target ${series.check_target_url}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setWindowValue(option.value);
                  setRawChecksPage(1);
                }}
                className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                  windowValue === option.value
                    ? "bg-primary text-white"
                    : "border border-slate-200 text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
                }`}
                title={option.helper}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          {summaryLoading && <p className="ui-body text-slate-500 dark:text-slate-400">Loading endpoint metadata...</p>}
          {!summaryLoading && !selectedEndpoint && (
            <PageBanner tone="warning">Endpoint not found in summary. It may have been deleted.</PageBanner>
          )}

          {selectedEndpoint?.error_message && (
            <PageBanner tone={selectedEndpoint.status === "up" ? "info" : "warning"}>Last check: {selectedEndpoint.error_message}</PageBanner>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">Current status</p>
              <div className="mt-2">
                <StatusPill status={selectedEndpoint?.status ?? "unknown"} />
              </div>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">Current latency</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">
                {formatLatency(selectedEndpoint?.status === "down" ? null : selectedEndpoint?.latency_ms)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">Availability ({windowValue})</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">{formatPercent(windowAvailability)}</p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">Average latency ({windowValue})</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">{formatLatency(windowAverageLatency)}</p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">P95 latency ({windowValue})</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">{formatLatency(windowP95Latency)}</p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="ui-caption text-slate-500 dark:text-slate-400">Checks in range</p>
              <p className="mt-2 ui-body font-semibold text-slate-900 dark:text-slate-100">{series?.data_points ?? 0}</p>
            </div>
          </div>

          {seriesLoading && <p className="ui-body text-slate-500 dark:text-slate-400">Loading endpoint charts...</p>}

          {!seriesLoading && (
            <div className="space-y-6">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Endpoint Timeline</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Status timeline with real duration per segment. Hover for start/end, duration and cause.
                </p>
                <div className="mt-3">
                  {(series?.series.length ?? 0) === 0 ? (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">No status timeline data for this range.</p>
                  ) : (
                    <div className="space-y-3">
                      <EndpointTimelineBar
                        points={series?.series ?? []}
                        rangeStart={series?.start}
                        rangeEnd={series?.end}
                        className="h-5"
                        selectedSegmentKey={selectedTimelineSegmentKey}
                        onSegmentSelect={(segment) => setSelectedTimelineSegmentKey(segment.key)}
                      />
                      {selectedTimelineSegment && (
                        <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
                          <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                            Selected Segment ({timelineSegments.findIndex((segment) => segment.key === selectedTimelineSegment.key) + 1}/{timelineSegments.length})
                          </p>
                          <div className="mt-1 grid gap-1">
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              Status:{" "}
                              <span className={`font-semibold ${statusTextClass(selectedTimelineSegment.status)}`}>
                                {STATUS_LABELS[selectedTimelineSegment.status]}
                              </span>
                            </p>
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              Start: <span className="font-semibold">{formatTimestamp(selectedTimelineSegment.startTimestamp)}</span>
                            </p>
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              End: <span className="font-semibold">{formatTimestamp(selectedTimelineSegment.endTimestamp)}</span>
                            </p>
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              Duration: <span className="font-semibold">{formatDurationShort(selectedTimelineSegment.durationMs)}</span>
                            </p>
                            <p className="ui-caption text-slate-600 dark:text-slate-300">
                              Latency: <span className="font-semibold">{formatLatency(selectedTimelineSegment.latencyMs ?? null)}</span>
                            </p>
                            {selectedTimelineSegment.cause && (
                              <p className="ui-caption text-slate-600 dark:text-slate-300">
                                Cause: <span className="font-semibold">{selectedTimelineSegment.cause}</span>
                              </p>
                            )}
                          </div>
                          <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Use left/right arrow keys to move between segments.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Latency (ms)</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {formatCheckMode(series?.check_mode ?? selectedEndpoint?.check_mode)} latency from{" "}
                  {latencyDisplayMode === "rollup" ? "5-minute rollups" : "daily aggregates"}.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 ui-caption text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded bg-blue-500" />
                    {latencyDisplayMode === "rollup" ? "Rollup latency" : "Average latency"}
                  </span>
                  {latencyDisplayMode === "daily" && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4 border-t border-dashed border-orange-500" />
                      P95 latency
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-4 rounded-sm border border-amber-500/60 bg-amber-400/30" />
                    Degraded window
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-4 rounded-sm border border-rose-500/60 bg-rose-400/30" />
                    Down window
                  </span>
                </div>
                <div className="mt-3 h-64">
                  {latencyPoints.length === 0 ? (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">No latency data for this range.</p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={latencySeries}>
                          {latencyStatusBands.map((band, index) => (
                            <ReferenceArea
                              key={`${band.status}-${band.startMs}-${band.endMs}-${index}`}
                              x1={band.startMs}
                              x2={band.endMs}
                              fill={band.status === "down" ? "rgba(244, 63, 94, 0.20)" : "rgba(245, 158, 11, 0.18)"}
                              strokeOpacity={0}
                              ifOverflow="extendDomain"
                            />
                          ))}
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                          <XAxis
                            dataKey="timestampMs"
                            type="number"
                            scale="time"
                            domain={latencyXAxisDomain}
                            tickFormatter={formatLatencyTick}
                            tickCount={latencyXAxisTickCount}
                            minTickGap={latencyXAxisMinTickGap}
                            interval="preserveStartEnd"
                            stroke="#94A3B8"
                          />
                          <YAxis
                            tickFormatter={(value) => `${value} ms`}
                            stroke="#94A3B8"
                            allowDecimals={false}
                            domain={[
                              0,
                              (dataMax: number) => (Number.isFinite(dataMax) && dataMax > 0 ? Math.ceil(dataMax * 1.1) : 100),
                            ]}
                          />
                          <Tooltip content={renderLatencyTooltip} />
                          <Line
                            type="monotone"
                            dataKey="latency_ms"
                            name={latencyDisplayMode === "rollup" ? "Rollup latency" : "Average latency"}
                            stroke="#3B82F6"
                            strokeWidth={2}
                            dot={latencySeries.length === 1 ? { r: 3 } : false}
                            connectNulls={false}
                          />
                          {latencyDisplayMode === "daily" && (
                            <Line
                              type="monotone"
                              dataKey="p95_latency_ms"
                              name="P95 latency"
                              stroke="#F97316"
                              strokeWidth={2}
                              strokeDasharray="5 5"
                              dot={false}
                              connectNulls={false}
                            />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                      {latencySamplesCount === 0 && latencyStatusBands.length > 0 && (
                        <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                          No measurable latency in this range (endpoint unavailable or degraded).
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Raw Healthchecks</p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">Raw check values for this endpoint and selected range.</p>
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {rawChecksTotal} checks · Page {rawChecksPage}/{rawChecksTotalPages}
                  </p>
                </div>
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-700">
                  <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        {["Check", "Status", "Latency", "HTTP", "Mode", "Error"].map((label) => (
                          <th key={label} className="px-4 py-2.5 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {rawChecksTableStatus === "loading" && (
                        <TableEmptyState colSpan={6} message="Loading raw healthchecks..." />
                      )}
                      {rawChecksTableStatus === "error" && (
                        <TableEmptyState colSpan={6} message="Unable to load raw healthchecks." tone="error" />
                      )}
                      {rawChecksTableStatus === "empty" && (
                        <TableEmptyState colSpan={6} message="No raw checks for this range." />
                      )}
                      {rawChecks.map((check, index) => (
                        <tr key={`${check.checked_at}-${index}`}>
                          <td className="px-4 py-3 ui-caption text-slate-500 dark:text-slate-400">{formatTimestamp(check.checked_at)}</td>
                          <td className="px-4 py-3"><StatusPill status={check.status} /></td>
                          <td className="px-4 py-3 ui-caption text-slate-500 dark:text-slate-400">{formatLatency(check.latency_ms ?? null)}</td>
                          <td className="px-4 py-3 ui-caption text-slate-500 dark:text-slate-400">{check.http_status ?? "-"}</td>
                          <td className="px-4 py-3 ui-caption text-slate-500 dark:text-slate-400">{formatCheckMode(check.check_mode)}</td>
                          <td className="px-4 py-3 ui-caption text-slate-500 dark:text-slate-400">{check.error_message || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRawChecksPage((current) => Math.max(1, current - 1))}
                    disabled={rawChecksLoading || rawChecksPage <= 1}
                    className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 transition enabled:hover:border-primary enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:enabled:hover:border-primary-500 dark:enabled:hover:text-primary-200"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setRawChecksPage((current) => Math.min(rawChecksTotalPages, current + 1))}
                    disabled={rawChecksLoading || rawChecksPage >= rawChecksTotalPages}
                    className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 transition enabled:hover:border-primary enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:enabled:hover:border-primary-500 dark:enabled:hover:text-primary-200"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ListSectionCard
        title="Incidents"
        subtitle="Downtime or degraded periods detected for this endpoint."
      >
        <div className="overflow-x-auto">
          <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {["Status", "Start", "End", "Duration"].map((label) => (
                  <th key={label} className="px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {incidentsTableStatus === "loading" && (
                <TableEmptyState colSpan={4} message="Loading incidents..." />
              )}
              {incidentsTableStatus === "error" && (
                <TableEmptyState colSpan={4} message="Unable to load incidents." tone="error" />
              )}
              {incidentsTableStatus === "empty" && (
                <TableEmptyState colSpan={4} message="No incidents recorded for this range." />
              )}
              {incidents.map((incident, index) => (
                <tr key={`${incident.start}-${index}`}>
                  <td className="px-6 py-4"><StatusPill status={incident.status} /></td>
                  <td className="px-6 py-4 ui-caption text-slate-500 dark:text-slate-400">{formatTimestamp(incident.start)}</td>
                  <td className="px-6 py-4 ui-caption text-slate-500 dark:text-slate-400">{incident.end ? formatTimestamp(incident.end) : "Ongoing"}</td>
                  <td className="px-6 py-4 ui-caption text-slate-500 dark:text-slate-400">{incident.duration_minutes != null ? `${incident.duration_minutes} min` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ListSectionCard>
    </div>
  );
}

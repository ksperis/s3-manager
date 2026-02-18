/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type HealthCheckStatus = "unknown" | "up" | "degraded" | "down";
export type HealthWindow = "day" | "week" | "month" | "quarter" | "half_year" | "year";

export type EndpointHealthSummary = {
  endpoint_id: number;
  name: string;
  endpoint_url: string;
  status: HealthCheckStatus;
  checked_at: string;
  latency_ms?: number | null;
  http_status?: number | null;
  error_message?: string | null;
  check_mode?: "http" | "s3";
  check_target_url?: string | null;
};

export type EndpointHealthSummaryResponse = {
  generated_at: string;
  endpoints: EndpointHealthSummary[];
};

export type EndpointHealthPoint = {
  timestamp: string;
  status: HealthCheckStatus;
  latency_ms?: number | null;
  http_status?: number | null;
  check_mode?: "http" | "s3";
  check_type?: string;
  scope?: string;
};

export type EndpointHealthDailyPoint = {
  day: string;
  ok_count: number;
  degraded_count: number;
  down_count: number;
  avg_latency_ms?: number | null;
  p95_latency_ms?: number | null;
};

export type EndpointHealthSeries = {
  endpoint_id: number;
  window: string;
  start: string;
  end: string;
  data_points: number;
  check_mode?: "http" | "s3";
  check_target_url?: string | null;
  check_type?: string;
  scope?: string;
  resolution_seconds?: number;
  series: EndpointHealthPoint[];
  daily: EndpointHealthDailyPoint[];
};

export type EndpointHealthIncident = {
  start: string;
  end?: string | null;
  duration_minutes?: number | null;
  status: HealthCheckStatus;
  check_mode?: "http" | "s3";
  check_type?: string;
  scope?: string;
};

export type EndpointHealthIncidentsResponse = {
  endpoint_id: number;
  window: string;
  check_mode?: "http" | "s3";
  check_type?: string;
  scope?: string;
  incidents: EndpointHealthIncident[];
};

export type EndpointHealthRawCheck = {
  checked_at: string;
  status: HealthCheckStatus;
  latency_ms?: number | null;
  http_status?: number | null;
  error_message?: string | null;
  check_mode?: "http" | "s3";
};

export type EndpointHealthRawChecksResponse = {
  endpoint_id: number;
  window: string;
  start: string;
  end: string;
  page: number;
  page_size: number;
  total: number;
  checks: EndpointHealthRawCheck[];
};

export type EndpointHealthTimelinePoint = {
  timestamp: string;
  end_timestamp?: string | null;
  status: HealthCheckStatus;
  latency_ms?: number | null;
  reason?: string | null;
};

export type EndpointHealthOverviewEndpoint = {
  endpoint_id: number;
  name: string;
  endpoint_url: string;
  status: HealthCheckStatus;
  checked_at: string;
  latency_ms?: number | null;
  check_mode?: "http" | "s3";
  check_target_url?: string | null;
  availability_pct?: number | null;
  baseline_latency_ms?: number | null;
  timeline: EndpointHealthTimelinePoint[];
};

export type EndpointHealthOverviewResponse = {
  generated_at: string;
  window: string;
  start: string;
  end: string;
  endpoints: EndpointHealthOverviewEndpoint[];
};

export type EndpointHealthLatencyOverviewEndpoint = {
  endpoint_id: number;
  name: string;
  endpoint_url: string;
  status: HealthCheckStatus;
  checked_at: string;
  latency_ms?: number | null;
  check_mode?: "http" | "s3";
  check_target_url?: string | null;
  min_latency_ms?: number | null;
  avg_latency_ms?: number | null;
  max_latency_ms?: number | null;
  sample_count?: number;
  check_type?: string;
  scope?: string;
};

export type EndpointHealthLatencyOverviewResponse = {
  generated_at: string;
  window: string;
  start: string;
  end: string;
  endpoints: EndpointHealthLatencyOverviewEndpoint[];
};

export type EndpointHealthGlobalIncident = {
  endpoint_id: number;
  endpoint_name: string;
  endpoint_url?: string | null;
  status: HealthCheckStatus;
  start: string;
  end?: string | null;
  duration_minutes?: number | null;
  check_mode?: "http" | "s3";
  check_type?: string;
  scope?: string;
};

export type EndpointHealthGlobalIncidentsResponse = {
  window: string;
  start: string;
  end: string;
  total: number;
  incidents: EndpointHealthGlobalIncident[];
};

export type WorkspaceEndpointHealthEntry = {
  endpoint_id: number;
  name: string;
  endpoint_url: string;
  status: HealthCheckStatus;
  checked_at: string;
  latency_ms?: number | null;
  check_mode?: "http" | "s3";
  check_target_url?: string | null;
};

export type WorkspaceEndpointIncidentEntry = {
  endpoint_id: number;
  endpoint_name: string;
  endpoint_url?: string | null;
  status: HealthCheckStatus;
  start: string;
  end?: string | null;
  duration_minutes?: number | null;
  check_mode?: "http" | "s3";
  ongoing: boolean;
  recent: boolean;
};

export type WorkspaceEndpointHealthOverviewResponse = {
  generated_at: string;
  incident_highlight_minutes: number;
  endpoint_count: number;
  up_count: number;
  degraded_count: number;
  down_count: number;
  unknown_count: number;
  endpoints: WorkspaceEndpointHealthEntry[];
  incidents: WorkspaceEndpointIncidentEntry[];
};

export async function fetchHealthSummary(): Promise<EndpointHealthSummaryResponse> {
  const { data } = await client.get<EndpointHealthSummaryResponse>("/admin/health/summary");
  return data;
}

export async function fetchHealthSeries(endpointId: number, window: HealthWindow | string): Promise<EndpointHealthSeries> {
  const { data } = await client.get<EndpointHealthSeries>("/admin/health/series", {
    params: { endpoint_id: endpointId, window },
  });
  return data;
}

export async function fetchHealthIncidents(endpointId: number, window: HealthWindow | string): Promise<EndpointHealthIncidentsResponse> {
  const { data } = await client.get<EndpointHealthIncidentsResponse>("/admin/health/incidents", {
    params: { endpoint_id: endpointId, window },
  });
  return data;
}

export async function fetchHealthRawChecks(
  endpointId: number,
  window: HealthWindow | string,
  page = 1,
  pageSize = 25
): Promise<EndpointHealthRawChecksResponse> {
  const { data } = await client.get<EndpointHealthRawChecksResponse>("/admin/health/raw-checks", {
    params: { endpoint_id: endpointId, window, page, page_size: pageSize },
  });
  return data;
}

export async function fetchHealthOverview(window: HealthWindow | string): Promise<EndpointHealthOverviewResponse> {
  const { data } = await client.get<EndpointHealthOverviewResponse>("/admin/health/overview", {
    params: { window },
  });
  return data;
}

export async function fetchHealthLatencyOverview(window: HealthWindow | string = "day"): Promise<EndpointHealthLatencyOverviewResponse> {
  const { data } = await client.get<EndpointHealthLatencyOverviewResponse>("/admin/health/latency-overview", {
    params: { window },
  });
  return data;
}

export async function fetchHealthGlobalIncidents(
  window: HealthWindow | string = "half_year",
  limit = 300
): Promise<EndpointHealthGlobalIncidentsResponse> {
  const { data } = await client.get<EndpointHealthGlobalIncidentsResponse>("/admin/health/incidents-global", {
    params: { window, limit },
  });
  return data;
}

export async function fetchHealthWorkspaceOverview(endpointId?: number): Promise<WorkspaceEndpointHealthOverviewResponse> {
  const { data } = await client.get<WorkspaceEndpointHealthOverviewResponse>("/admin/health/workspace-overview", {
    params: endpointId ? { endpoint_id: endpointId } : undefined,
  });
  return data;
}

export async function fetchManagerWorkspaceHealthOverview(
  accountId: S3AccountSelector
): Promise<WorkspaceEndpointHealthOverviewResponse> {
  const { data } = await client.get<WorkspaceEndpointHealthOverviewResponse>("/manager/stats/endpoint-health", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchPortalWorkspaceHealthOverview(
  accountId: S3AccountSelector
): Promise<WorkspaceEndpointHealthOverviewResponse> {
  const { data } = await client.get<WorkspaceEndpointHealthOverviewResponse>("/portal/endpoint-health", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function runHealthchecks(): Promise<Record<string, unknown>> {
  const { data } = await client.post<Record<string, unknown>>("/admin/health/run");
  return data;
}

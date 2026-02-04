/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type HealthCheckStatus = "unknown" | "up" | "degraded" | "down";

export type EndpointHealthSummary = {
  endpoint_id: number;
  name: string;
  endpoint_url: string;
  status: HealthCheckStatus;
  checked_at: string;
  latency_ms?: number | null;
  http_status?: number | null;
  error_message?: string | null;
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
  series: EndpointHealthPoint[];
  daily: EndpointHealthDailyPoint[];
};

export type EndpointHealthIncident = {
  start: string;
  end?: string | null;
  duration_minutes?: number | null;
  status: HealthCheckStatus;
};

export type EndpointHealthIncidentsResponse = {
  endpoint_id: number;
  window: string;
  incidents: EndpointHealthIncident[];
};

export async function fetchHealthSummary(): Promise<EndpointHealthSummaryResponse> {
  const { data } = await client.get<EndpointHealthSummaryResponse>("/admin/health/summary");
  return data;
}

export async function fetchHealthSeries(endpointId: number, window: string): Promise<EndpointHealthSeries> {
  const { data } = await client.get<EndpointHealthSeries>("/admin/health/series", {
    params: { endpoint_id: endpointId, window },
  });
  return data;
}

export async function fetchHealthIncidents(endpointId: number, window: string): Promise<EndpointHealthIncidentsResponse> {
  const { data } = await client.get<EndpointHealthIncidentsResponse>("/admin/health/incidents", {
    params: { endpoint_id: endpointId, window },
  });
  return data;
}

export async function runHealthchecks(): Promise<Record<string, unknown>> {
  const { data } = await client.post<Record<string, unknown>>("/admin/health/run");
  return data;
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type UsageHistoryGranularity = "daily" | "hourly";
export type UsageHistorySubjectType = "all" | "account" | "s3_user";
export type UsageHistorySortBy = "period" | "subject" | "used_bytes" | "used_objects" | "ratio";
export type UsageHistorySortDir = "asc" | "desc";
export type UsageHistoryTrendWindow = "day" | "week" | "month";

export type UsageHistorySummary = {
  total_records: number;
  subjects_count: number;
  latest_collected_at?: string | null;
  max_usage_ratio_pct?: number | null;
};

export type UsageHistoryRecord = {
  id: number;
  granularity: UsageHistoryGranularity;
  period_start: string;
  storage_endpoint_id: number;
  endpoint_name: string;
  subject_type: "account" | "s3_user";
  subject_id: number;
  subject_name: string;
  subject_identifier?: string | null;
  used_bytes: number;
  used_objects: number;
  bucket_count?: number | null;
  quota_size_bytes?: number | null;
  quota_objects?: number | null;
  usage_ratio_pct?: number | null;
  samples_count?: number | null;
  collected_at: string;
};

export type UsageHistoryResponse = {
  items: UsageHistoryRecord[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  summary: UsageHistorySummary;
};

type UsageHistoryQuery = {
  granularity: UsageHistoryGranularity;
  endpointId?: number | null;
  subjectType?: UsageHistorySubjectType;
  start?: string | null;
  end?: string | null;
  page?: number;
  pageSize?: number;
  sortBy?: UsageHistorySortBy;
  sortDir?: UsageHistorySortDir;
};

type UsageHistoryCollectionResult = {
  started_at?: string;
  finished_at?: string;
  subjects_total?: number;
  subjects_processed?: number;
  history_hourly_upserts?: number;
  history_daily_upserts?: number;
  errors?: unknown[];
  warnings?: unknown[];
  status?: string;
  reason?: string;
};

export type UsageHistoryTrendPoint = {
  period_start: string;
  used_bytes: number;
  used_objects: number;
  bucket_count: number;
  max_usage_ratio_pct?: number | null;
  subjects_count: number;
  samples_count: number;
  collected_at?: string | null;
};

export type UsageHistoryTrendSummary = {
  total_records: number;
  points_count: number;
  subjects_count: number;
  latest_used_bytes: number;
  latest_used_objects: number;
  latest_bucket_count: number;
  latest_collected_at?: string | null;
  max_usage_ratio_pct?: number | null;
};

export type UsageHistoryTrendResponse = {
  window: UsageHistoryTrendWindow;
  granularity: UsageHistoryGranularity;
  available: boolean;
  unavailable_reason?: string | null;
  points: UsageHistoryTrendPoint[];
  summary: UsageHistoryTrendSummary;
};

type AdminUsageHistoryTrendsQuery = {
  window: UsageHistoryTrendWindow;
  endpointId?: number | null;
  subjectType?: UsageHistorySubjectType;
};

export async function listUsageHistory(query: UsageHistoryQuery): Promise<UsageHistoryResponse> {
  const params: Record<string, string | number> = {
    granularity: query.granularity,
    subject_type: query.subjectType ?? "all",
    page: query.page ?? 1,
    page_size: query.pageSize ?? 50,
    sort_by: query.sortBy ?? "period",
    sort_dir: query.sortDir ?? "desc",
  };
  if (query.endpointId != null) params.endpoint_id = query.endpointId;
  if (query.start) params.start = query.start;
  if (query.end) params.end = query.end;
  const { data } = await client.get<UsageHistoryResponse>("/admin/usage-history", { params });
  return data;
}

export async function collectUsageHistory(): Promise<UsageHistoryCollectionResult> {
  const { data } = await client.post<UsageHistoryCollectionResult>("/admin/usage-history/collect");
  return data;
}

export async function fetchAdminUsageHistoryTrends(
  query: AdminUsageHistoryTrendsQuery
): Promise<UsageHistoryTrendResponse> {
  const params: Record<string, string | number> = {
    window: query.window,
    subject_type: query.subjectType ?? "all",
  };
  if (query.endpointId != null) params.endpoint_id = query.endpointId;
  const { data } = await client.get<UsageHistoryTrendResponse>("/admin/usage-history/trends", { params });
  return data;
}

export async function fetchManagerUsageHistoryTrends(
  accountId: S3AccountSelector,
  window: UsageHistoryTrendWindow
): Promise<UsageHistoryTrendResponse> {
  const params = withS3AccountParam({ window }, accountId);
  const { data } = await client.get<UsageHistoryTrendResponse>("/manager/stats/usage-history-trends", { params });
  return data;
}

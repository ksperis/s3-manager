/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type UsageHistoryGranularity = "daily" | "hourly";
export type UsageHistorySubjectType = "all" | "account" | "s3_user";
export type UsageHistorySortBy = "period" | "subject" | "used_bytes" | "used_objects" | "ratio";
export type UsageHistorySortDir = "asc" | "desc";

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

export type UsageHistoryQuery = {
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

export type UsageHistoryCollectionResult = {
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

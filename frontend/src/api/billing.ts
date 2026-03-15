/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type BillingCoverage = {
  days_collected: number;
  days_in_month: number;
  coverage_ratio: number;
};

export type BillingCost = {
  currency?: string | null;
  storage_cost?: number | null;
  egress_cost?: number | null;
  ingress_cost?: number | null;
  requests_cost?: number | null;
  total_cost?: number | null;
  rate_card_name?: string | null;
};

export type BillingUsageTotals = {
  bytes_in: number;
  bytes_out: number;
  ops_total: number;
  ops_breakdown?: Record<string, number> | null;
};

export type BillingStorageTotals = {
  avg_bytes?: number | null;
  avg_gb_month?: number | null;
  total_objects?: number | null;
};

export type BillingSummary = {
  month: string;
  storage_endpoint_id?: number | null;
  usage: BillingUsageTotals;
  storage: BillingStorageTotals;
  coverage: BillingCoverage;
  cost?: BillingCost | null;
};

export type BillingSubjectSummary = {
  subject_type: string;
  subject_id: number;
  name: string;
  rgw_identifier?: string | null;
  storage: BillingStorageTotals;
  usage: BillingUsageTotals;
  cost?: BillingCost | null;
};

export type BillingSubjectsResponse = {
  items: BillingSubjectSummary[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
};

export type BillingDailySeriesPoint = {
  day: string;
  storage_bytes?: number | null;
  bytes_in?: number | null;
  bytes_out?: number | null;
  ops_total?: number | null;
};

export type BillingSubjectDetail = {
  month: string;
  subject_type: string;
  subject_id: number;
  name: string;
  rgw_identifier?: string | null;
  daily: BillingDailySeriesPoint[];
  usage: BillingUsageTotals;
  storage: BillingStorageTotals;
  coverage: BillingCoverage;
  cost?: BillingCost | null;
};

export async function getBillingSummary(month: string, endpointId?: number | null): Promise<BillingSummary> {
  const params: Record<string, string | number> = { month };
  if (endpointId != null) {
    params.endpoint_id = endpointId;
  }
  const { data } = await client.get<BillingSummary>("/admin/billing/summary", { params });
  return data;
}

export async function getBillingSubjects(
  month: string,
  endpointId: number,
  subjectType: "account" | "s3_user",
  page = 1,
  pageSize = 25,
  sortBy = "name",
  sortDir: "asc" | "desc" = "asc",
): Promise<BillingSubjectsResponse> {
  const params: Record<string, string | number> = {
    month,
    endpoint_id: endpointId,
    type: subjectType,
    page,
    page_size: pageSize,
    sort_by: sortBy,
    sort_dir: sortDir,
  };
  const { data } = await client.get<BillingSubjectsResponse>("/admin/billing/subjects", { params });
  return data;
}

export async function getBillingSubjectDetail(
  month: string,
  endpointId: number,
  subjectType: "account" | "s3_user",
  subjectId: number,
): Promise<BillingSubjectDetail> {
  const params: Record<string, string | number> = { month, endpoint_id: endpointId };
  const { data } = await client.get<BillingSubjectDetail>(`/admin/billing/subject/${subjectType}/${subjectId}`, {
    params,
  });
  return data;
}

export async function downloadBillingCsv(month: string, endpointId: number): Promise<Blob> {
  const params: Record<string, string | number> = { month, endpoint_id: endpointId };
  const response = await client.get("/admin/billing/export.csv", { params, responseType: "blob" });
  return response.data as Blob;
}

export async function collectBillingDaily(day: string): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { day };
  const { data } = await client.post<Record<string, unknown>>("/admin/billing/collect/daily", null, { params });
  return data;
}

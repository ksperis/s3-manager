/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type BucketUsagePoint = {
  name: string;
  used_bytes?: number | null;
  object_count?: number | null;
};

export type BucketOverview = {
  bucket_count: number;
  non_empty_buckets: number;
  empty_buckets: number;
  avg_bucket_size_bytes?: number | null;
  avg_objects_per_bucket?: number | null;
  largest_bucket?: BucketUsagePoint | null;
  most_objects_bucket?: BucketUsagePoint | null;
};

export type S3AccountUsagePoint = {
  account_id: string;
  account_name?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  bucket_count?: number | null;
};

export type S3UserUsagePoint = {
  user_id: number;
  user_name?: string | null;
  rgw_user_uid?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  bucket_count?: number | null;
};

export type AdminStats = {
  total_accounts: number;
  total_users: number;
  total_admins: number;
  total_portal_users?: number;
  total_s3_users: number;
  total_buckets: number;
  account_usage?: S3AccountUsagePoint[];
  s3_user_usage?: S3UserUsagePoint[];
  storage_totals?: StorageTotals;
  traffic?: AdminTrafficStats | null;
  traffic_error?: string | null;
  generated_at?: string;
};

export type ManagerStats = {
  total_buckets: number;
  total_iam_users: number;
  total_iam_groups: number;
  total_iam_roles: number;
  total_iam_policies: number;
  total_bytes?: number;
  total_objects?: number;
  bucket_usage?: BucketUsagePoint[];
  bucket_overview?: BucketOverview | null;
};

export type TrafficSeriesPoint = {
  timestamp: string;
  bytes_in: number;
  bytes_out: number;
  ops: number;
  success_ops: number;
};

export type TrafficTotals = {
  bytes_in: number;
  bytes_out: number;
  ops: number;
  success_ops: number;
  success_rate?: number | null;
};

export type TrafficBucketRanking = {
  bucket: string;
  bytes_total: number;
  bytes_in: number;
  bytes_out: number;
  ops: number;
  success_ops: number;
  success_ratio?: number | null;
};

export type TrafficUserRanking = {
  user: string;
  bytes_total: number;
  bytes_in: number;
  bytes_out: number;
  ops: number;
  success_ops: number;
  success_ratio?: number | null;
};

export type TrafficRequestBreakdown = {
  group: string;
  bytes_in: number;
  bytes_out: number;
  ops: number;
};

export type TrafficCategoryBreakdown = {
  category: string;
  bytes_in: number;
  bytes_out: number;
  ops: number;
};

export type ManagerTrafficStats = {
  window: string;
  start: string;
  end: string;
  resolution: string;
  bucket_filter?: string | null;
  data_points: number;
  series: TrafficSeriesPoint[];
  totals: TrafficTotals;
  bucket_rankings: TrafficBucketRanking[];
  user_rankings: TrafficUserRanking[];
  request_breakdown: TrafficRequestBreakdown[];
  category_breakdown: TrafficCategoryBreakdown[];
};

export type TrafficWindow = "hour" | "day" | "week" | "month";

export type StorageTotals = {
  used_bytes?: number | null;
  object_count?: number | null;
  bucket_count?: number | null;
  accounts_with_usage?: number | null;
};

export type AdminTrafficStats = ManagerTrafficStats;
export type AdminStorageStats = AdminStats;

export type AdminSummary = {
  total_accounts: number;
  total_users: number;
  total_admins: number;
  total_none_users: number;
  total_portal_users?: number;
  total_s3_users: number;
  assigned_accounts: number;
  unassigned_accounts: number;
  assigned_s3_users: number;
  unassigned_s3_users: number;
  total_endpoints: number;
  total_ceph_endpoints: number;
  total_other_endpoints: number;
  total_connections: number;
};

export async function fetchAdminSummary(): Promise<AdminSummary> {
  const { data } = await client.get<AdminSummary>("/admin/stats/summary");
  return data;
}

export async function fetchAdminStats(window: TrafficWindow = "week", endpointId?: number | null): Promise<AdminStats> {
  const params: Record<string, string | number> = { window };
  if (endpointId != null) {
    params.endpoint_id = endpointId;
  }
  const { data } = await client.get<AdminStats>("/admin/stats/overview", { params });
  return data;
}

export async function fetchAdminStorage(endpointId?: number | null): Promise<AdminStorageStats> {
  const params: Record<string, number> = {};
  if (endpointId != null) {
    params.endpoint_id = endpointId;
  }
  const { data } = await client.get<AdminStorageStats>("/admin/stats/storage", { params });
  return data;
}

export async function fetchAdminTraffic(window: TrafficWindow = "week", endpointId?: number | null): Promise<AdminTrafficStats> {
  const params: Record<string, string | number> = { window };
  if (endpointId != null) {
    params.endpoint_id = endpointId;
  }
  const { data } = await client.get<AdminTrafficStats>("/admin/stats/traffic", { params });
  return data;
}

export async function fetchManagerStats(accountId?: S3AccountSelector): Promise<ManagerStats> {
  const { data } = await client.get<ManagerStats>("/manager/stats/overview", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchAdminAccountStats(accountId: number): Promise<ManagerStats> {
  const { data } = await client.get<ManagerStats>("/admin/stats/account", {
    params: { account_id: accountId },
  });
  return data;
}

export async function fetchAdminS3UserStats(userId: number): Promise<ManagerStats> {
  const { data } = await client.get<ManagerStats>("/admin/stats/s3-user", {
    params: { user_id: userId },
  });
  return data;
}

export async function fetchManagerTraffic(
  accountId: S3AccountSelector,
  window: TrafficWindow,
  bucket?: string
): Promise<ManagerTrafficStats> {
  const baseParams: Record<string, string | number> = { window };
  if (bucket) {
    baseParams.bucket = bucket;
  }
  const params = withS3AccountParam(baseParams, accountId);
  const { data } = await client.get<ManagerTrafficStats>("/manager/stats/traffic", { params });
  return data;
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { ManagerTrafficStats, TrafficWindow } from "./stats";

export type CephAdminBucketUsagePoint = {
  name: string;
  used_bytes?: number | null;
  object_count?: number | null;
};

export type CephAdminEntityMetrics = {
  total_bytes?: number | null;
  total_objects?: number | null;
  bucket_count: number;
  bucket_usage: CephAdminBucketUsagePoint[];
  generated_at: string;
};

export type CephAdminClusterOwnerUsagePoint = {
  owner: string;
  used_bytes?: number | null;
  object_count?: number | null;
  bucket_count: number;
};

export type CephAdminClusterStorageTotals = {
  used_bytes?: number | null;
  object_count?: number | null;
  bucket_count?: number | null;
  owners_with_usage?: number | null;
};

export type CephAdminClusterStorageMetrics = {
  total_buckets: number;
  bucket_usage: CephAdminBucketUsagePoint[];
  owner_usage: CephAdminClusterOwnerUsagePoint[];
  storage_totals: CephAdminClusterStorageTotals;
  generated_at: string;
};

export type CephAdminClusterTrafficMetrics = ManagerTrafficStats;

export async function getCephAdminAccountMetrics(
  endpointId: number,
  accountId: string,
): Promise<CephAdminEntityMetrics> {
  const { data } = await client.get<CephAdminEntityMetrics>(
    `/ceph-admin/endpoints/${endpointId}/accounts/${encodeURIComponent(accountId)}/metrics`,
  );
  return data;
}

export async function getCephAdminUserMetrics(
  endpointId: number,
  uid: string,
  tenant?: string | null,
): Promise<CephAdminEntityMetrics> {
  const { data } = await client.get<CephAdminEntityMetrics>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/metrics`,
    { params: tenant ? { tenant } : undefined },
  );
  return data;
}

export async function fetchCephAdminClusterStorage(
  endpointId: number,
): Promise<CephAdminClusterStorageMetrics> {
  const { data } = await client.get<CephAdminClusterStorageMetrics>(
    `/ceph-admin/endpoints/${endpointId}/metrics/storage`,
  );
  return data;
}

export async function fetchCephAdminClusterTraffic(
  endpointId: number,
  window: TrafficWindow = "week",
  bucket?: string,
): Promise<CephAdminClusterTrafficMetrics> {
  const { data } = await client.get<CephAdminClusterTrafficMetrics>(
    `/ceph-admin/endpoints/${endpointId}/metrics/traffic`,
    { params: { window, bucket: bucket || undefined } },
  );
  return data;
}

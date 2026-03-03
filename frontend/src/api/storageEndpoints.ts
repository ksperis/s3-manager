/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type StorageProvider = "ceph" | "other";

export type StorageEndpointFeature = {
  enabled: boolean;
  endpoint?: string | null;
};

export type StorageEndpointHealthcheckFeature = {
  enabled: boolean;
  mode: "http" | "s3";
  url?: string | null;
};

export type StorageEndpointFeatures = {
  admin: StorageEndpointFeature;
  account: StorageEndpointFeature;
  sts: StorageEndpointFeature;
  usage: StorageEndpointFeature;
  metrics: StorageEndpointFeature;
  static_website: StorageEndpointFeature;
  iam: StorageEndpointFeature;
  sns: StorageEndpointFeature;
  sse: StorageEndpointFeature;
  healthcheck: StorageEndpointHealthcheckFeature;
};

export type StorageEndpointAdminOpsPermissions = {
  users_read: boolean;
  users_write: boolean;
  accounts_read: boolean;
  accounts_write: boolean;
};

export type StorageEndpoint = {
  id: number;
  name: string;
  endpoint_url: string;
  admin_endpoint?: string | null;
  region?: string | null;
  verify_tls: boolean;
  provider: StorageProvider;
  admin_access_key?: string | null;
  has_admin_secret: boolean;
  supervision_access_key?: string | null;
  has_supervision_secret: boolean;
  ceph_admin_access_key?: string | null;
  has_ceph_admin_secret: boolean;
  capabilities?: Record<string, boolean> | null;
  admin_ops_permissions?: StorageEndpointAdminOpsPermissions | null;
  features_config?: string | null;
  features?: StorageEndpointFeatures;
  is_default: boolean;
  is_editable: boolean;
  created_at: string;
  updated_at: string;
};

export type StorageEndpointMeta = {
  managed_by_env: boolean;
};

export type StorageEndpointPayload = {
  name: string;
  endpoint_url: string;
  admin_endpoint?: string | null;
  region?: string | null;
  verify_tls?: boolean;
  provider?: StorageProvider;
  admin_access_key?: string | null;
  admin_secret_key?: string | null;
  supervision_access_key?: string | null;
  supervision_secret_key?: string | null;
  ceph_admin_access_key?: string | null;
  ceph_admin_secret_key?: string | null;
  features_config?: string | null;
};

export type StorageEndpointFeatureDetectionPayload = {
  endpoint_id?: number | null;
  endpoint_url: string;
  admin_endpoint?: string | null;
  region?: string | null;
  verify_tls?: boolean | null;
  admin_access_key?: string | null;
  admin_secret_key?: string | null;
  supervision_access_key?: string | null;
  supervision_secret_key?: string | null;
};

export type StorageEndpointFeatureDetectionResult = {
  admin: boolean;
  account: boolean;
  usage: boolean;
  metrics: boolean;
  admin_error?: string | null;
  account_error?: string | null;
  metrics_error?: string | null;
  usage_error?: string | null;
  warnings: string[];
};

export type ListStorageEndpointsParams = {
  include_admin_ops_permissions?: boolean;
};

export type GetStorageEndpointParams = {
  include_admin_ops_permissions?: boolean;
};

export async function listStorageEndpoints(params?: ListStorageEndpointsParams): Promise<StorageEndpoint[]> {
  const { data } = await client.get<StorageEndpoint[]>("/admin/storage-endpoints", { params });
  return data;
}

export async function getStorageEndpoint(id: number, params?: GetStorageEndpointParams): Promise<StorageEndpoint> {
  const { data } = await client.get<StorageEndpoint>(`/admin/storage-endpoints/${id}`, { params });
  return data;
}

export async function fetchStorageEndpointsMeta(): Promise<StorageEndpointMeta> {
  const { data } = await client.get<StorageEndpointMeta>("/admin/storage-endpoints/meta");
  return data;
}

export async function detectStorageEndpointFeatures(
  payload: StorageEndpointFeatureDetectionPayload
): Promise<StorageEndpointFeatureDetectionResult> {
  const { data } = await client.post<StorageEndpointFeatureDetectionResult>("/admin/storage-endpoints/detect-features", payload);
  return data;
}

export async function createStorageEndpoint(payload: StorageEndpointPayload): Promise<StorageEndpoint> {
  const { data } = await client.post<StorageEndpoint>("/admin/storage-endpoints", payload);
  return data;
}

export async function updateStorageEndpoint(
  id: number,
  payload: StorageEndpointPayload
): Promise<StorageEndpoint> {
  const { data } = await client.put<StorageEndpoint>(`/admin/storage-endpoints/${id}`, payload);
  return data;
}

export async function setDefaultStorageEndpoint(id: number): Promise<StorageEndpoint> {
  const { data } = await client.put<StorageEndpoint>(`/admin/storage-endpoints/${id}/default`);
  return data;
}

export async function deleteStorageEndpoint(id: number): Promise<void> {
  await client.delete(`/admin/storage-endpoints/${id}`);
}

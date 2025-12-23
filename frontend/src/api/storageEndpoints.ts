/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type StorageProvider = "ceph" | "other";

export type StorageEndpoint = {
  id: number;
  name: string;
  endpoint_url: string;
  admin_endpoint?: string | null;
  region?: string | null;
  provider: StorageProvider;
  admin_access_key?: string | null;
  has_admin_secret: boolean;
  supervision_access_key?: string | null;
  has_supervision_secret: boolean;
  is_default: boolean;
  is_editable: boolean;
  created_at: string;
  updated_at: string;
};

export type StorageEndpointPayload = {
  name: string;
  endpoint_url: string;
  admin_endpoint?: string | null;
  region?: string | null;
  provider?: StorageProvider;
  admin_access_key?: string | null;
  admin_secret_key?: string | null;
  supervision_access_key?: string | null;
  supervision_secret_key?: string | null;
};

export async function listStorageEndpoints(): Promise<StorageEndpoint[]> {
  const { data } = await client.get<StorageEndpoint[]>("/admin/storage-endpoints");
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

export async function deleteStorageEndpoint(id: number): Promise<void> {
  await client.delete(`/admin/storage-endpoints/${id}`);
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { PaginatedResponse } from "./types";

export type S3ConnectionAdminItem = {
  id: number;
  name: string;
  storage_endpoint_id?: number | null;
  endpoint_url: string;
  is_public?: boolean | null;
  is_shared?: boolean | null;
  is_active?: boolean | null;
  visibility?: "private" | "shared" | "public" | null;
  access_manager?: boolean | null;
  access_browser?: boolean | null;
  capabilities?: Record<string, unknown> | null;
  credential_owner_type?: string | null;
  credential_owner_identifier?: string | null;
  provider_hint?: string | null;
  region?: string | null;
  force_path_style?: boolean | null;
  verify_tls?: boolean | null;
  owner_user_id?: number | null;
  owner_email?: string | null;
  user_count: number;
  user_ids?: number[];
  last_used_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PaginatedS3ConnectionsResponse = PaginatedResponse<S3ConnectionAdminItem>;

export type S3ConnectionSummary = {
  id: number;
  name: string;
  owner_user_id?: number | null;
  is_public?: boolean | null;
  is_shared?: boolean | null;
  is_active?: boolean | null;
  visibility?: "private" | "shared" | "public" | null;
};

export type ListS3ConnectionsParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
};

export type CreateS3ConnectionPayload = {
  name: string;
  visibility?: "private" | "shared" | "public" | null;
  provider_hint?: string | null;
  storage_endpoint_id?: number | null;
  is_public?: boolean | null;
  is_shared?: boolean | null;
  is_active?: boolean | null;
  access_manager?: boolean | null;
  access_browser?: boolean | null;
  credential_owner_type?: string | null;
  credential_owner_identifier?: string | null;
  endpoint_url?: string | null;
  region?: string | null;
  access_key_id: string;
  secret_access_key: string;
  force_path_style?: boolean | null;
  verify_tls?: boolean | null;
};

export type UpdateS3ConnectionPayload = {
  name?: string | null;
  visibility?: "private" | "shared" | "public" | null;
  provider_hint?: string | null;
  storage_endpoint_id?: number | null;
  is_public?: boolean | null;
  is_shared?: boolean | null;
  is_active?: boolean | null;
  access_manager?: boolean | null;
  access_browser?: boolean | null;
  credential_owner_type?: string | null;
  credential_owner_identifier?: string | null;
  endpoint_url?: string | null;
  region?: string | null;
  force_path_style?: boolean | null;
  verify_tls?: boolean | null;
};

export type RotateS3ConnectionCredentialsPayload = {
  access_key_id: string;
  secret_access_key: string;
};

export type ValidateS3ConnectionCredentialsPayload = {
  storage_endpoint_id?: number | null;
  endpoint_url?: string | null;
  region?: string | null;
  access_key_id: string;
  secret_access_key: string;
  force_path_style?: boolean;
  verify_tls?: boolean;
};

export type S3ConnectionCredentialsValidationResult = {
  ok: boolean;
  severity: "success" | "warning" | "error";
  code?: string | null;
  message: string;
};

export type S3ConnectionUserLink = {
  user_id: number;
  email?: string | null;
  full_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type UpsertS3ConnectionUserLinkPayload = {
  user_id: number;
};

export async function listAdminS3Connections(params?: ListS3ConnectionsParams): Promise<PaginatedS3ConnectionsResponse> {
  const { data } = await client.get<PaginatedS3ConnectionsResponse>("/admin/s3-connections", { params });
  return data;
}

export async function listMinimalS3Connections(): Promise<S3ConnectionSummary[]> {
  const { data } = await client.get<S3ConnectionSummary[]>("/admin/s3-connections/minimal");
  return data;
}

export async function createAdminS3Connection(payload: CreateS3ConnectionPayload): Promise<S3ConnectionAdminItem> {
  const { data } = await client.post<S3ConnectionAdminItem>("/admin/s3-connections", payload);
  return data;
}

export async function updateAdminS3Connection(connectionId: number, payload: UpdateS3ConnectionPayload): Promise<S3ConnectionAdminItem> {
  const { data } = await client.put<S3ConnectionAdminItem>(`/admin/s3-connections/${connectionId}`, payload);
  return data;
}

export async function rotateAdminS3ConnectionCredentials(
  connectionId: number,
  payload: RotateS3ConnectionCredentialsPayload
): Promise<S3ConnectionAdminItem> {
  const { data } = await client.put<S3ConnectionAdminItem>(`/admin/s3-connections/${connectionId}/credentials`, payload);
  return data;
}

export async function deleteAdminS3Connection(connectionId: number): Promise<void> {
  await client.delete(`/admin/s3-connections/${connectionId}`);
}

export async function listS3ConnectionUsers(connectionId: number): Promise<S3ConnectionUserLink[]> {
  const { data } = await client.get<S3ConnectionUserLink[]>(`/admin/s3-connections/${connectionId}/users`);
  return data;
}

export async function upsertS3ConnectionUser(
  connectionId: number,
  payload: UpsertS3ConnectionUserLinkPayload
): Promise<S3ConnectionUserLink> {
  const { data } = await client.post<S3ConnectionUserLink>(`/admin/s3-connections/${connectionId}/users`, payload);
  return data;
}

export async function removeS3ConnectionUser(connectionId: number, userId: number): Promise<void> {
  await client.delete(`/admin/s3-connections/${connectionId}/users/${userId}`);
}

export async function validateAdminS3ConnectionCredentials(
  payload: ValidateS3ConnectionCredentialsPayload
): Promise<S3ConnectionCredentialsValidationResult> {
  const { data } = await client.post<S3ConnectionCredentialsValidationResult>(
    "/admin/s3-connections/validate-credentials",
    payload
  );
  return data;
}

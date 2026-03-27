/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { TagDefinitionInput, TagDefinitionSummary } from "./tags";

export type S3Connection = {
  id: number;
  name: string;
  tags: TagDefinitionSummary[];
  storage_endpoint_id?: number | null;
  created_by_user_id: number;
  is_shared?: boolean | null;
  is_active?: boolean | null;
  access_manager?: boolean | null;
  access_browser?: boolean | null;
  credential_owner_type?: string | null;
  credential_owner_identifier?: string | null;
  endpoint_url: string;
  region?: string | null;
  provider_hint?: string | null;
  access_key_id?: string | null;
  force_path_style?: boolean | null;
  verify_tls?: boolean | null;
  capabilities?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_used_at?: string | null;
};

export type CreateConnectionPayload = {
  name: string;
  provider_hint?: string | null;
  storage_endpoint_id?: number | null;
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
  tags?: TagDefinitionInput[] | null;
};

export type UpdateConnectionPayload = {
  name?: string | null;
  provider_hint?: string | null;
  storage_endpoint_id?: number | null;
  is_active?: boolean | null;
  access_manager?: boolean | null;
  access_browser?: boolean | null;
  credential_owner_type?: string | null;
  credential_owner_identifier?: string | null;
  endpoint_url?: string | null;
  region?: string | null;
  access_key_id?: string | null;
  secret_access_key?: string | null;
  force_path_style?: boolean | null;
  verify_tls?: boolean | null;
  tags?: TagDefinitionInput[] | null;
};

export type ValidateConnectionCredentialsPayload = {
  storage_endpoint_id?: number | null;
  endpoint_url?: string | null;
  region?: string | null;
  access_key_id: string;
  secret_access_key: string;
  force_path_style?: boolean;
  verify_tls?: boolean;
};

export type ConnectionCredentialsValidationResult = {
  ok: boolean;
  severity: "success" | "warning" | "error";
  code?: string | null;
  message: string;
};

export async function listConnections(): Promise<S3Connection[]> {
  const { data } = await client.get<S3Connection[]>("/connections");
  return data;
}

export async function createConnection(payload: CreateConnectionPayload): Promise<S3Connection> {
  const { data } = await client.post<S3Connection>("/connections", payload);
  return data;
}

export async function updateConnection(connectionId: number, payload: UpdateConnectionPayload): Promise<S3Connection> {
  const { data } = await client.put<S3Connection>(`/connections/${connectionId}`, payload);
  return data;
}

export async function deleteConnection(connectionId: number): Promise<void> {
  await client.delete(`/connections/${connectionId}`);
}

export async function validateConnectionCredentials(
  payload: ValidateConnectionCredentialsPayload
): Promise<ConnectionCredentialsValidationResult> {
  const { data } = await client.post<ConnectionCredentialsValidationResult>("/connections/validate-credentials", payload);
  return data;
}

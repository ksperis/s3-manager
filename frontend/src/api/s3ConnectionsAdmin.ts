/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type {
  S3CredentialsValidationPayload,
  S3CredentialsValidationResult,
} from "./s3CredentialsValidation";
import { PaginatedResponse } from "./types";
import type { TagDefinitionInput, TagDefinitionSummary } from "./tags";
import type { UiGroupAvatarDescriptor } from "./groups";
import type { UserAvatarDescriptor, UserSummary } from "./users";
import type { CredentialOwnerType } from "./connections";

export type S3ConnectionAdminItem = {
  id: number;
  name: string;
  tags: TagDefinitionSummary[];
  storage_endpoint_id?: number | null;
  endpoint_url: string;
  is_active?: boolean | null;
  execution_status: "ready" | "remediation_required";
  remediation_reason?: string | null;
  capabilities?: Record<string, unknown> | null;
  credential_owner_type?: CredentialOwnerType | null;
  credential_owner_identifier?: string | null;
  provider_hint?: string | null;
  region?: string | null;
  force_path_style?: boolean | null;
  verify_tls?: boolean | null;
  created_by_user_id: number;
  created_by_email?: string | null;
  created_by_full_name?: string | null;
  created_by_avatar?: UserAvatarDescriptor | null;
  user_count: number;
  user_details?: UserSummary[];
  group_details?: { id: number; name: string; avatar?: UiGroupAvatarDescriptor | null }[];
  last_used_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type PaginatedS3ConnectionsResponse = PaginatedResponse<S3ConnectionAdminItem>;

export type S3ConnectionSummary = {
  id: number;
  name: string;
  created_by_user_id: number;
  is_active?: boolean | null;
  execution_status: "ready" | "remediation_required";
};

type ListS3ConnectionsParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
};

export type CreateAdminS3ConnectionPayload = {
  name: string;
  provider_hint?: string | null;
  storage_endpoint_id?: number | null;
  credential_owner_type?: CredentialOwnerType | null;
  credential_owner_identifier?: string | null;
  endpoint_url?: string | null;
  region?: string | null;
  access_key_id: string;
  secret_access_key: string;
  force_path_style?: boolean | null;
  verify_tls?: boolean | null;
  tags?: TagDefinitionInput[] | null;
};

export type UpdateAdminS3ConnectionPayload = {
  name?: string | null;
  group_ids?: number[] | null;
  user_ids?: number[] | null;
  remediation_action?: "activate_manager" | null;
  provider_hint?: string | null;
  storage_endpoint_id?: number | null;
  is_active?: boolean | null;
  credential_owner_type?: CredentialOwnerType | null;
  credential_owner_identifier?: string | null;
  endpoint_url?: string | null;
  region?: string | null;
  force_path_style?: boolean | null;
  verify_tls?: boolean | null;
  tags?: TagDefinitionInput[] | null;
  credentials?: {
    access_key_id: string;
    secret_access_key: string;
  } | null;
};

export async function listAdminS3Connections(params?: ListS3ConnectionsParams): Promise<PaginatedS3ConnectionsResponse> {
  const { data } = await client.get<PaginatedS3ConnectionsResponse>("/admin/s3-connections", { params });
  return data;
}

export async function listMinimalS3Connections(): Promise<S3ConnectionSummary[]> {
  const { data } = await client.get<S3ConnectionSummary[]>("/admin/s3-connections/minimal");
  return data;
}

export async function createAdminS3Connection(payload: CreateAdminS3ConnectionPayload): Promise<S3ConnectionAdminItem> {
  const { data } = await client.post<S3ConnectionAdminItem>("/admin/s3-connections", payload);
  return data;
}

export async function updateAdminS3Connection(connectionId: number, payload: UpdateAdminS3ConnectionPayload): Promise<S3ConnectionAdminItem> {
  const { data } = await client.put<S3ConnectionAdminItem>(`/admin/s3-connections/${connectionId}`, payload);
  return data;
}

export async function deleteAdminS3Connection(connectionId: number): Promise<void> {
  await client.delete(`/admin/s3-connections/${connectionId}`);
}

export async function validateAdminS3ConnectionCredentials(
  payload: S3CredentialsValidationPayload
): Promise<S3CredentialsValidationResult> {
  const { data } = await client.post<S3CredentialsValidationResult>(
    "/admin/s3-connections/validate-credentials",
    payload
  );
  return data;
}

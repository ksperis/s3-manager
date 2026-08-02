/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { timeoutForRequestProfile } from "./client";
import type { PortalSettingsAdminUpdate } from "./appSettings";
import type { PortalAccountSettings } from "./portal";
import { PaginatedResponse } from "./types";
import type { TagDefinitionInput, TagDefinitionSummary } from "./tags";
import type { UiGroupAvatarDescriptor } from "./groups";
import type { UserAvatarDescriptor } from "./users";
import type { AccountAccessRole } from "./accountRoles";

export type AccountUserLink = {
  user_id: number;
  role: AccountAccessRole;
  user_email?: string | null;
  user_full_name?: string | null;
  user_avatar?: UserAvatarDescriptor | null;
};

export type AccountGroupLink = {
  group_id: number;
  group_name?: string | null;
  group_avatar?: UiGroupAvatarDescriptor | null;
  role: AccountAccessRole;
};

export type S3Account = {
  id: string;
  db_id?: number | null;
  name: string;
  tags: TagDefinitionSummary[];
  /** Portal-only projected role; Admin account associations use user_links/group_links.role. */
  account_role?: "portal_user" | "portal_manager" | null;
  quota_max_size_gb?: number | null;
  quota_max_objects?: number | null;
  rgw_account_id?: string;
  rgw_user_uid?: string | null;
  is_s3_user?: boolean | null;
  root_user_email?: string | null;
  root_user_id?: number | null;
  email?: string | null;
  used_bytes?: number | null;
  user_ids?: number[] | null;
  user_links?: AccountUserLink[] | null;
  group_ids?: number[] | null;
  group_links?: AccountGroupLink[] | null;
  bucket_count?: number | null;
  rgw_user_count?: number | null;
  rgw_user_uids?: string[] | null;
  rgw_topic_count?: number | null;
  rgw_topics?: string[] | null;
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_url?: string | null;
  storage_endpoint_is_default?: boolean | null;
  storage_endpoint_capabilities?: Record<string, boolean> | null;
  allow_manager_bucket_quota?: boolean;
};

export type S3AccountSummary = {
  id: string;
  db_id?: number | null;
  name: string;
  tags: TagDefinitionSummary[];
  rgw_account_id?: string | null;
  is_s3_user?: boolean | null;
  user_ids?: number[] | null;
  user_links?: AccountUserLink[] | null;
  group_ids?: number[] | null;
  group_links?: AccountGroupLink[] | null;
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_url?: string | null;
  storage_endpoint_capabilities?: Record<string, boolean> | null;
  allow_manager_bucket_quota?: boolean;
};

type PaginatedS3AccountsResponse = PaginatedResponse<S3Account>;

type ListS3AccountsParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include_quota?: boolean;
  include_rgw_details?: boolean;
};

export async function listS3Accounts(params?: ListS3AccountsParams): Promise<PaginatedS3AccountsResponse> {
  const { data } = await client.get<PaginatedS3AccountsResponse>("/admin/accounts", { params });
  return data;
}

export async function listMinimalS3Accounts(): Promise<S3AccountSummary[]> {
  const { data } = await client.get<S3AccountSummary[]>("/admin/accounts/minimal");
  return data;
}

type GetS3AccountOptions = {
  includeUsage?: boolean;
};

export async function getS3Account(accountId: number, options?: GetS3AccountOptions): Promise<S3Account> {
  const params = options?.includeUsage ? { include_usage: options.includeUsage } : undefined;
  const { data } = await client.get<S3Account>(`/admin/accounts/${accountId}`, { params });
  return data;
}

type CreateS3AccountPayload = {
  name: string;
  email?: string | null;
  quota_max_size_gb?: number | null;
  quota_max_size_unit?: string | null;
  quota_max_objects?: number | null;
  storage_endpoint_id?: number | null;
  tags?: TagDefinitionInput[] | null;
};

export async function createS3Account(payload: CreateS3AccountPayload): Promise<S3Account> {
  const { data } = await client.post<S3Account>("/admin/accounts", payload);
  return data;
}

type UpdateS3AccountPayload = {
  quota_max_size_gb?: number | null;
  quota_max_size_unit?: string | null;
  quota_max_objects?: number | null;
  user_ids?: number[] | null;
  user_links?: AccountUserLink[] | null;
  group_ids?: number[] | null;
  group_links?: AccountGroupLink[] | null;
  name?: string | null;
  email?: string | null;
  storage_endpoint_id?: number | null;
  tags?: TagDefinitionInput[] | null;
  allow_manager_bucket_quota?: boolean | null;
};

export async function updateS3Account(accountId: number, payload: UpdateS3AccountPayload): Promise<S3Account> {
  const { data } = await client.put<S3Account>(`/admin/accounts/${accountId}`, payload);
  return data;
}

export async function deleteS3Account(accountId: number, options?: { deleteRgw?: boolean }): Promise<void> {
  const params = options?.deleteRgw ? { delete_rgw: options.deleteRgw } : undefined;
  await client.delete(`/admin/accounts/${accountId}`, { params });
}

export type ImportS3AccountPayload = {
  rgw_account_id: string;
  name?: string | null;
  email?: string | null;
  storage_endpoint_id?: number | null;
};

export async function importS3Accounts(payload: ImportS3AccountPayload[]): Promise<S3Account[]> {
  const { data } = await client.post<S3Account[]>("/admin/accounts/import", payload, {
    timeout: timeoutForRequestProfile("long_running"),
  });
  return data;
}

export async function fetchAccountPortalSettings(accountId: number): Promise<PortalAccountSettings> {
  const { data } = await client.get<PortalAccountSettings>(`/admin/accounts/${accountId}/portal-settings`);
  return data;
}

export async function updateAccountPortalSettings(
  accountId: number,
  payload: PortalSettingsAdminUpdate
): Promise<PortalAccountSettings> {
  const { data } = await client.put<PortalAccountSettings>(`/admin/accounts/${accountId}/portal-settings`, payload);
  return data;
}

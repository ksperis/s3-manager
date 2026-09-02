/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { PaginatedResponse } from "./types";
import type { TagDefinitionInput, TagDefinitionSummary } from "./tags";
import type { UiGroupAvatarDescriptor } from "./groups";
import type { UserAvatarDescriptor } from "./users";

export type S3User = {
  id: number;
  name: string;
  rgw_user_uid: string;
  tags: TagDefinitionSummary[];
  email?: string | null;
  created_at?: string | null;
  user_links?: S3UserUserLink[];
  group_links?: S3UserGroupLink[];
  quota_max_size_gb?: number | null;
  quota_max_objects?: number | null;
  storage_endpoint_id: number;
  storage_endpoint_name: string;
  storage_endpoint_url: string;
  bucket_count?: number | null;
  allow_bucket_quota_management?: boolean;
  allow_access_key_management?: boolean;
  allow_managed_private_connection_provisioning?: boolean;
};

export type S3UserUserLink = {
  user_id: number;
  user_email?: string | null;
  user_full_name?: string | null;
  user_avatar?: UserAvatarDescriptor | null;
  allow_manager_browser_data_access?: boolean;
};

export type S3UserGroupLink = {
  group_id: number;
  group_name?: string | null;
  group_avatar?: UiGroupAvatarDescriptor | null;
  allow_manager_browser_data_access?: boolean;
};

export type S3UserSummary = {
  id: number;
  name: string;
  rgw_user_uid: string;
  tags: TagDefinitionSummary[];
  storage_endpoint_id: number;
  storage_endpoint_name: string;
  storage_endpoint_url: string;
  allow_bucket_quota_management?: boolean;
  allow_access_key_management?: boolean;
  allow_managed_private_connection_provisioning?: boolean;
};

type CreateS3UserPayload = {
  name: string;
  uid?: string | null;
  email?: string | null;
  quota_max_size_gb?: number | null;
  quota_max_size_unit?: string | null;
  quota_max_objects?: number | null;
  storage_endpoint_id: number;
  tags?: TagDefinitionInput[] | null;
  allow_bucket_quota_management?: boolean | null;
  allow_access_key_management?: boolean | null;
  allow_managed_private_connection_provisioning?: boolean | null;
};

type ImportS3UserPayload = {
  uid: string;
  name?: string | null;
  email?: string | null;
  storage_endpoint_id: number;
};

export type UpdateS3UserPayload = {
  name?: string | null;
  email?: string | null;
  user_links?: S3UserUserLink[] | null;
  group_links?: S3UserGroupLink[] | null;
  quota_max_size_gb?: number | null;
  quota_max_size_unit?: string | null;
  quota_max_objects?: number | null;
  tags?: TagDefinitionInput[] | null;
  allow_bucket_quota_management?: boolean | null;
  allow_access_key_management?: boolean | null;
  allow_managed_private_connection_provisioning?: boolean | null;
};

export type S3UserAccessKey = {
  access_key_id: string;
  status?: string | null;
  created_at?: string | null;
  is_ui_managed: boolean;
  is_active: boolean;
};

export type CreatedS3UserAccessKey = {
  access_key_id: string;
  secret_access_key: string;
  created_at?: string | null;
};

type PaginatedS3UsersResponse = PaginatedResponse<S3User>;

type ListS3UsersParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include_quota?: boolean;
};

export async function listS3Users(params?: ListS3UsersParams): Promise<PaginatedS3UsersResponse> {
  const { data } = await client.get<PaginatedS3UsersResponse>("/admin/s3-users", { params });
  return data;
}

export async function listMinimalS3Users(): Promise<S3UserSummary[]> {
  const { data } = await client.get<S3UserSummary[]>("/admin/s3-users/minimal");
  return data;
}

export async function createS3User(payload: CreateS3UserPayload): Promise<S3User> {
  const { data } = await client.post<S3User>("/admin/s3-users", payload);
  return data;
}

export async function getS3User(userId: number, params?: { include_quota?: boolean }): Promise<S3User> {
  const { data } = await client.get<S3User>(`/admin/s3-users/${userId}`, { params });
  return data;
}

export async function getS3UserWithBuckets(userId: number, params?: { include_quota?: boolean }): Promise<S3User> {
  const { data } = await client.get<S3User>(`/admin/s3-users/${userId}`, {
    params: { include_buckets: true, ...(params ?? {}) },
  });
  return data;
}

export async function importS3Users(payload: ImportS3UserPayload[]): Promise<S3User[]> {
  const { data } = await client.post<S3User[]>("/admin/s3-users/import", payload);
  return data;
}

export async function updateS3User(userId: number, payload: UpdateS3UserPayload): Promise<S3User> {
  const { data } = await client.put<S3User>(`/admin/s3-users/${userId}`, payload);
  return data;
}

export async function rotateS3UserKeys(userId: number): Promise<S3User> {
  const { data } = await client.post<S3User>(`/admin/s3-users/${userId}/rotate-keys`);
  return data;
}

export async function listS3UserKeys(userId: number): Promise<S3UserAccessKey[]> {
  const { data } = await client.get<S3UserAccessKey[]>(`/admin/s3-users/${userId}/keys`);
  return data;
}

export async function createS3UserKey(userId: number): Promise<CreatedS3UserAccessKey> {
  const { data } = await client.post<CreatedS3UserAccessKey>(`/admin/s3-users/${userId}/keys`);
  return data;
}

export async function updateS3UserKeyStatus(userId: number, accessKeyId: string, active: boolean): Promise<S3UserAccessKey> {
  const { data } = await client.put<S3UserAccessKey>(
    `/admin/s3-users/${userId}/keys/${encodeURIComponent(accessKeyId)}/status`,
    { active }
  );
  return data;
}

export async function deleteS3UserKey(userId: number, accessKeyId: string): Promise<void> {
  await client.delete(`/admin/s3-users/${userId}/keys/${encodeURIComponent(accessKeyId)}`);
}

export async function deleteS3User(userId: number, options?: { deleteRgw?: boolean }): Promise<void> {
  const params = options?.deleteRgw ? { delete_rgw: options.deleteRgw } : undefined;
  await client.delete(`/admin/s3-users/${userId}`, { params });
}

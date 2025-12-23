/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { PaginatedResponse } from "./types";

export type AccountUserLink = {
  user_id: number;
  account_role?: string | null;
  account_admin?: boolean | null;
};

export type S3Account = {
  id: string;
  db_id?: number | null;
  name: string;
  quota_max_size_gb?: number | null;
  quota_max_objects?: number | null;
  rgw_account_id?: string;
  rgw_user_uid?: string | null;
  root_user_email?: string | null;
  root_user_id?: number | null;
  email?: string | null;
  used_bytes?: number | null;
  user_ids?: number[] | null;
  user_links?: AccountUserLink[] | null;
  bucket_count?: number | null;
  rgw_user_count?: number | null;
  rgw_user_uids?: string[] | null;
  rgw_topic_count?: number | null;
  rgw_topics?: string[] | null;
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_url?: string | null;
};

export type S3AccountSummary = {
  id: string;
  db_id?: number | null;
  name: string;
  rgw_account_id?: string | null;
  user_ids?: number[] | null;
  user_links?: AccountUserLink[] | null;
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_url?: string | null;
};

export type PaginatedS3AccountsResponse = PaginatedResponse<S3Account>;

export type ListS3AccountsParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
};

export async function listS3Accounts(params?: ListS3AccountsParams): Promise<PaginatedS3AccountsResponse> {
  const { data } = await client.get<PaginatedS3AccountsResponse>("/admin/accounts", { params });
  return data;
}

export async function listMinimalS3Accounts(): Promise<S3AccountSummary[]> {
  const { data } = await client.get<S3AccountSummary[]>("/admin/accounts/minimal");
  return data;
}

export type GetS3AccountOptions = {
  includeUsage?: boolean;
};

export async function getS3Account(accountId: number, options?: GetS3AccountOptions): Promise<S3Account> {
  const params = options?.includeUsage ? { include_usage: options.includeUsage } : undefined;
  const { data } = await client.get<S3Account>(`/admin/accounts/${accountId}`, { params });
  return data;
}

export type CreateS3AccountPayload = {
  name: string;
  email?: string | null;
  quota_max_size_gb?: number | null;
  quota_max_objects?: number | null;
  storage_endpoint_id?: number | null;
};

export async function createS3Account(payload: CreateS3AccountPayload): Promise<S3Account> {
  const { data } = await client.post<S3Account>("/admin/accounts", payload);
  return data;
}

export type UpdateS3AccountPayload = {
  quota_max_size_gb?: number | null;
  quota_max_objects?: number | null;
  user_ids?: number[] | null;
  user_links?: AccountUserLink[] | null;
  name?: string | null;
  email?: string | null;
  storage_endpoint_id?: number | null;
};

export async function updateS3Account(accountId: number, payload: UpdateS3AccountPayload): Promise<S3Account> {
  const { data } = await client.put<S3Account>(`/admin/accounts/${accountId}`, payload);
  return data;
}

export async function deleteS3Account(accountId: number, options?: { deleteRgw?: boolean }): Promise<void> {
  const params = options?.deleteRgw ? { delete_rgw: options.deleteRgw } : undefined;
  await client.delete(`/admin/accounts/${accountId}`, { params });
}

export async function unlinkS3Account(accountId: number): Promise<void> {
  await client.post(`/admin/accounts/${accountId}/unlink`);
}

export type ImportS3AccountPayload = {
  rgw_account_id?: string | null;
  name?: string | null;
  email?: string | null;
  access_key?: string | null;
  secret_key?: string | null;
  storage_endpoint_id?: number | null;
};

export async function importS3Accounts(payload: ImportS3AccountPayload[]): Promise<S3Account[]> {
  const { data } = await client.post<S3Account[]>("/admin/accounts/import", payload);
  return data;
}

export async function importS3AccountsByIds(ids: string[]): Promise<S3Account[]> {
  const payload = ids.map((id) => ({ rgw_account_id: id }));
  return importS3Accounts(payload);
}

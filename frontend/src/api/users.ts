/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { PaginatedResponse } from "./types";

export type AccountMembership = {
  account_id: number;
  account_role?: string | null;
  account_admin?: boolean | null;
};

export type User = {
  id: number;
  email: string;
  full_name?: string | null;
  display_name?: string | null;
  picture_url?: string | null;
  role?: string | null;
  can_access_ceph_admin?: boolean;
  can_access_storage_ops?: boolean;
  ui_language?: "en" | "fr" | "de" | null;
  quota_alerts_enabled?: boolean;
  quota_alerts_global_watch?: boolean;
  accounts?: number[];
  account_links?: AccountMembership[];
  s3_users?: number[];
  s3_user_details?: { id: number; name: string }[];
  s3_connections?: number[];
  s3_connection_details?: {
    id: number;
    name: string;
    access_manager?: boolean | null;
    access_browser?: boolean | null;
  }[];
  is_active?: boolean;
  is_root?: boolean;
  auth_provider?: string | null;
  last_login_at?: string | null;
};

export type UserSummary = {
  id: number;
  email: string;
};

export type CreateUserPayload = {
  email: string;
  password: string;
  role?: string;
  can_access_ceph_admin?: boolean;
};

export type UpdateUserPayload = {
  email?: string;
  password?: string;
  role?: string;
  can_access_ceph_admin?: boolean;
  can_access_storage_ops?: boolean;
  is_active?: boolean;
  s3_user_ids?: number[] | null;
  s3_connection_ids?: number[] | null;
};

export type UpdateCurrentUserPayload = {
  full_name?: string | null;
  ui_language?: "en" | "fr" | "de" | null;
  quota_alerts_enabled?: boolean;
  quota_alerts_global_watch?: boolean;
  current_password?: string;
  new_password?: string;
};

export type PaginatedUsersResponse = PaginatedResponse<User>;

export type ListUsersParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
};

export async function listUsers(params?: ListUsersParams): Promise<PaginatedUsersResponse> {
  const { data } = await client.get<PaginatedUsersResponse>("/admin/users", { params });
  return data;
}

export async function listMinimalUsers(): Promise<UserSummary[]> {
  const { data } = await client.get<UserSummary[]>("/admin/users/minimal");
  return data;
}

export async function createUser(payload: CreateUserPayload): Promise<User> {
  const { data } = await client.post<User>("/admin/users", payload);
  return data;
}

export async function updateUser(userId: number, payload: UpdateUserPayload): Promise<User> {
  const { data } = await client.put<User>(`/admin/users/${userId}`, payload);
  return data;
}

export async function deleteUser(userId: number): Promise<void> {
  await client.delete(`/admin/users/${userId}`);
}

export async function fetchCurrentUser(): Promise<User> {
  const { data } = await client.get<User>("/users/me");
  return data;
}

export async function updateCurrentUser(payload: UpdateCurrentUserPayload): Promise<User> {
  const { data } = await client.put<User>("/users/me", payload);
  return data;
}

export async function assignUserToS3Account(
  userId: number,
  accountId: number,
  accountRole?: string | null,
  accountAdmin?: boolean | null,
): Promise<User> {
  const { data } = await client.post<User>(`/admin/users/${userId}/assign-account`, {
    account_id: accountId,
    account_role: accountRole,
    account_admin: accountAdmin,
  });
  return data;
}

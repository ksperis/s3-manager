/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { PaginatedResponse } from "./types";

export type AccountMembership = {
  account_id: number;
  account_root?: boolean | null;
  manager_root_access?: boolean | null;
};

export type PortalMembershipSummary = {
  account_id: number;
  role_key: string;
};

export type User = {
  id: number;
  email: string;
  role?: string | null;
  accounts?: number[];
  account_links?: AccountMembership[];
  manager_root_access?: number[];
  portal_memberships?: PortalMembershipSummary[];
  s3_users?: number[];
  s3_user_details?: { id: number; name: string }[];
  is_active?: boolean;
  is_root?: boolean;
  has_rgw_credentials?: boolean;
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
  rgw_access_key?: string | null;
  rgw_secret_key?: string | null;
};

export type UpdateUserPayload = {
  email?: string;
  password?: string;
  role?: string;
  is_active?: boolean;
  rgw_access_key?: string | null;
  rgw_secret_key?: string | null;
  s3_user_ids?: number[] | null;
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

export async function assignUserToS3Account(
  userId: number,
  accountId: number,
  portalRoleKey?: string | null,
  managerRootAccess?: boolean | null,
): Promise<User> {
  const { data } = await client.post<User>(`/admin/users/${userId}/assign-account`, {
    account_id: accountId,
    portal_role_key: portalRoleKey,
    manager_root_access: managerRootAccess,
  });
  return data;
}

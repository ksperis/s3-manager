/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { timeoutForRequestProfile } from "./client";
import { PaginatedResponse } from "./types";
import type { AccountAccessRole } from "./accountRoles";

export type UiRole = "ui_superadmin" | "ui_admin" | "ui_user" | "ui_none";

export type AccountMembership = {
  account_id: number;
  role: AccountAccessRole;
  allow_manager_browser_data_access?: boolean;
  is_root?: boolean;
};

export type S3UserMembership = {
  s3_user_id: number;
  allow_manager_browser_data_access?: boolean;
};

export type EffectiveAccountMembership = AccountMembership & {
  provenance: {
    direct_role?: AccountAccessRole | null;
    direct_determines_effective_role: boolean;
    groups: Array<{
      group_id: number;
      group_name: string;
      role: AccountAccessRole;
      determines_effective_role: boolean;
    }>;
  };
};

export type ManagerToolAccess = {
  bucket_compare: boolean;
  bucket_integrity_check: boolean;
  bucket_migration: boolean;
  bucket_purge: boolean;
  feature_rules: boolean;
};

export type UiPreferences = {
  theme?: "light" | "dark" | null;
  selected_portal_account_id?: string | null;
};

export type UserAvatarPreference = "auto" | "uploaded" | "gravatar" | "initials";
export type UserAvatarSource = "uploaded" | "provider" | "gravatar" | "initials";

export type UserAvatarDescriptor = {
  preference: UserAvatarPreference;
  source: UserAvatarSource;
  url?: string | null;
  initials: string;
  updated_at?: string | null;
};

export type EffectiveUserAccess = {
  can_access_ceph_admin: boolean;
  can_access_storage_ops: boolean;
  can_create_manual_private_connections: boolean;
  can_provision_managed_private_connections: boolean;
  has_owned_private_connections: boolean;
  manager_tool_access: ManagerToolAccess;
  browser_advanced_features_enabled: boolean;
  account_links: EffectiveAccountMembership[];
  s3_user_details: { id: number; name: string }[];
  s3_connection_details: {
    id: number;
    name: string;
  }[];
};

export type User = {
  id: number;
  email: string;
  full_name?: string | null;
  display_name?: string | null;
  picture_url?: string | null;
  avatar?: UserAvatarDescriptor | null;
  role: UiRole;
  can_access_ceph_admin?: boolean;
  can_access_storage_ops?: boolean;
  can_create_manual_private_connections?: boolean;
  can_provision_managed_private_connections?: boolean;
  manager_tool_access?: ManagerToolAccess | null;
  browser_advanced_features_enabled?: boolean;
  ui_language?: "en" | "fr" | "de" | null;
  quota_alerts_enabled?: boolean;
  quota_alerts_global_watch?: boolean;
  ui_preferences?: UiPreferences | null;
  account_links?: AccountMembership[];
  group_details?: { id: number; name: string }[];
  s3_user_links?: S3UserMembership[];
  s3_user_details?: { id: number; name: string }[];
  s3_connection_details?: {
    id: number;
    name: string;
  }[];
  effective_access?: EffectiveUserAccess | null;
  is_active?: boolean;
  is_root?: boolean;
  auth_provider?: string | null;
  last_login_at?: string | null;
};

export type UserSummary = {
  id: number;
  email: string;
  full_name?: string | null;
  display_name?: string | null;
  avatar?: UserAvatarDescriptor | null;
  role: UiRole;
};

export type CreateUserPayload = {
  email: string;
  password: string;
  role?: UiRole;
  can_access_ceph_admin?: boolean;
  can_access_storage_ops?: boolean;
  can_create_manual_private_connections?: boolean;
  can_provision_managed_private_connections?: boolean;
  manager_tool_access?: ManagerToolAccess | null;
  browser_advanced_features_enabled?: boolean;
  group_ids?: number[] | null;
};

export type UpdateUserPayload = {
  email?: string;
  password?: string;
  role?: UiRole;
  can_access_ceph_admin?: boolean;
  can_access_storage_ops?: boolean;
  can_create_manual_private_connections?: boolean;
  can_provision_managed_private_connections?: boolean;
  manager_tool_access?: ManagerToolAccess | null;
  browser_advanced_features_enabled?: boolean;
  is_active?: boolean;
  account_links?: AccountMembership[] | null;
  s3_user_links?: S3UserMembership[] | null;
  s3_connection_ids?: number[] | null;
  group_ids?: number[] | null;
};

type UpdateCurrentUserPayload = {
  full_name?: string | null;
  avatar_preference?: UserAvatarPreference;
  ui_language?: "en" | "fr" | "de" | null;
  quota_alerts_enabled?: boolean;
  quota_alerts_global_watch?: boolean;
  ui_preferences?: UiPreferences | null;
  current_password?: string;
  new_password?: string;
};

type PaginatedUsersResponse = PaginatedResponse<User>;

type ListUsersParams = {
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
  const { data } = await client.get<User>("/users/me", {
    timeout: timeoutForRequestProfile("interactive"),
  });
  return data;
}

export async function updateCurrentUser(payload: UpdateCurrentUserPayload): Promise<User> {
  const { data } = await client.put<User>("/users/me", payload);
  return data;
}

export async function uploadCurrentUserAvatar(file: File): Promise<User> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await client.put<User>("/users/me/avatar", formData);
  return data;
}

export async function deleteCurrentUserAvatar(): Promise<User> {
  const { data } = await client.delete<User>("/users/me/avatar");
  return data;
}

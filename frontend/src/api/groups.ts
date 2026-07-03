/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { AccountMembership, ManagerToolAccess } from "./users";
import type { PaginatedResponse } from "./types";

export type UiGroupSummary = {
  id: number;
  name: string;
  description?: string | null;
};

export type UiGroupUserDetail = {
  id: number;
  email: string;
  role?: string | null;
};

export type UiGroup = {
  id: number;
  name: string;
  description?: string | null;
  can_access_ceph_admin?: boolean;
  can_access_storage_ops?: boolean;
  manager_tool_access?: ManagerToolAccess | null;
  browser_advanced_features_enabled?: boolean;
  user_ids?: number[];
  user_details?: UiGroupUserDetail[];
  accounts?: number[];
  account_details?: { id: number; name: string; rgw_account_id?: string | null }[];
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
  created_at?: string | null;
  updated_at?: string | null;
};

export type UiGroupPayload = {
  name?: string;
  description?: string | null;
  can_access_ceph_admin?: boolean;
  can_access_storage_ops?: boolean;
  manager_tool_access?: ManagerToolAccess | null;
  browser_advanced_features_enabled?: boolean;
  user_ids?: number[];
  account_links?: AccountMembership[];
  s3_user_ids?: number[];
  s3_connection_ids?: number[];
};

export type PaginatedUiGroupsResponse = PaginatedResponse<UiGroup>;

export type ListUiGroupsParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
};

export async function listGroups(params?: ListUiGroupsParams): Promise<PaginatedUiGroupsResponse> {
  const { data } = await client.get<PaginatedUiGroupsResponse>("/admin/groups", { params });
  return data;
}

export async function listMinimalGroups(): Promise<UiGroupSummary[]> {
  const { data } = await client.get<UiGroupSummary[]>("/admin/groups/minimal");
  return data;
}

export async function createGroup(payload: UiGroupPayload): Promise<UiGroup> {
  const { data } = await client.post<UiGroup>("/admin/groups", payload);
  return data;
}

export async function updateGroup(groupId: number, payload: UiGroupPayload): Promise<UiGroup> {
  const { data } = await client.put<UiGroup>(`/admin/groups/${groupId}`, payload);
  return data;
}

export async function deleteGroup(groupId: number): Promise<void> {
  await client.delete(`/admin/groups/${groupId}`);
}

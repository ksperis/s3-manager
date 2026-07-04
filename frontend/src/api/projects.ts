/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { PaginatedResponse } from "./types";

export type ProjectPortalRole = "portal_user" | "portal_manager";

export type ProjectAccountLinkInput = {
  account_id: number;
  display_name?: string | null;
  sort_order?: number;
};

export type ProjectUserLinkInput = {
  user_id: number;
  account_role: ProjectPortalRole;
};

export type ProjectGroupLinkInput = {
  group_id: number;
  account_role: ProjectPortalRole;
};

export type ProjectAccountLink = {
  account_id: number;
  account_name: string;
  display_name: string;
  sort_order: number;
  rgw_account_id?: string | null;
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_url?: string | null;
  storage_endpoint_zonegroup?: string | null;
};

export type ProjectUserLink = {
  user_id: number;
  user_email: string;
  account_role: ProjectPortalRole | string;
};

export type ProjectGroupLink = {
  group_id: number;
  group_name: string;
  account_role: ProjectPortalRole | string;
};

export type Project = {
  id: number;
  name: string;
  description?: string | null;
  account_links: ProjectAccountLink[];
  user_links: ProjectUserLink[];
  group_links: ProjectGroupLink[];
  account_count: number;
  user_count: number;
  group_count: number;
  created_at: string;
  updated_at: string;
};

export type ProjectSummary = {
  id: number;
  name: string;
  description?: string | null;
  account_count: number;
  user_count: number;
  group_count: number;
};

export type PaginatedProjectsResponse = PaginatedResponse<Project>;

export type ListProjectsParams = {
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
};

export type ProjectPayload = {
  name?: string;
  description?: string | null;
  account_links?: ProjectAccountLinkInput[];
  user_links?: ProjectUserLinkInput[];
  group_links?: ProjectGroupLinkInput[];
};

export type CreateProjectPayload = Required<Pick<ProjectPayload, "name">> & ProjectPayload;

export type ProvisionProjectAccountsPayload = {
  endpoint_ids: number[];
  base_name?: string | null;
  email?: string | null;
};

export type ProvisionProjectAccountsResponse = {
  project: Project;
  created_account_ids: number[];
  reused_endpoint_ids: number[];
};

export async function listProjects(params?: ListProjectsParams): Promise<PaginatedProjectsResponse> {
  const { data } = await client.get<PaginatedProjectsResponse>("/admin/projects", { params });
  return data;
}

export async function listMinimalProjects(): Promise<ProjectSummary[]> {
  const { data } = await client.get<ProjectSummary[]>("/admin/projects/minimal");
  return data;
}

export async function getProject(projectId: number): Promise<Project> {
  const { data } = await client.get<Project>(`/admin/projects/${projectId}`);
  return data;
}

export async function createProject(payload: CreateProjectPayload): Promise<Project> {
  const { data } = await client.post<Project>("/admin/projects", payload);
  return data;
}

export async function updateProject(projectId: number, payload: ProjectPayload): Promise<Project> {
  const { data } = await client.put<Project>(`/admin/projects/${projectId}`, payload);
  return data;
}

export async function deleteProject(projectId: number): Promise<void> {
  await client.delete(`/admin/projects/${projectId}`);
}

export async function provisionProjectAccounts(
  projectId: number,
  payload: ProvisionProjectAccountsPayload
): Promise<ProvisionProjectAccountsResponse> {
  const { data } = await client.post<ProvisionProjectAccountsResponse>(
    `/admin/projects/${projectId}/provision-accounts`,
    payload
  );
  return data;
}

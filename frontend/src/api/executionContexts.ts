/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { timeoutForRequestProfile } from "./client";
import type { AccountAccessRole } from "./accountRoles";
import type { TagDefinitionSummary } from "./tags";

export type ExecutionContextKind = "account" | "connection" | "legacy_user" | "portal_account";

export type ExecutionContextCapabilities = {
  can_manage_iam: boolean;
  sts_capable: boolean;
  admin_api_capable: boolean;
};

export type ExecutionContext = {
  kind: ExecutionContextKind;
  id: string;
  display_name: string;
  tags: TagDefinitionSummary[];
  endpoint_tags: TagDefinitionSummary[];
  hidden?: boolean;
  role?: AccountAccessRole | null;
  manager_account_is_admin?: boolean | null;
  rgw_account_id?: string | null;
  max_buckets?: number | null;
  max_users?: number | null;
  max_roles?: number | null;
  max_groups?: number | null;
  quota_max_size_gb?: number | null;
  quota_max_objects?: number | null;
  endpoint_id?: number | null;
  endpoint_name: string;
  endpoint_is_default: boolean;
  endpoint_provider?: "ceph" | "aws" | "other" | null;
  endpoint_url: string;
  storage_endpoint_capabilities: Record<string, boolean>;
  capabilities: ExecutionContextCapabilities;
};

type ExecutionWorkspace = "manager" | "browser";

export async function listExecutionContexts(
  workspace?: ExecutionWorkspace,
  options?: { signal?: AbortSignal }
): Promise<ExecutionContext[]> {
  const { data } = await client.get<ExecutionContext[]>("/me/execution-contexts", {
      params: workspace ? { workspace } : undefined,
      signal: options?.signal,
      timeout: timeoutForRequestProfile("interactive"),
  });
  return data;
}

export type WorkspaceAccess = {
  admin: { available: boolean; context_count: number };
  ceph_admin: { available: boolean; context_count: number };
  storage_ops: { available: boolean; context_count: number };
  manager: { available: boolean; context_count: number };
  browser: { available: boolean; context_count: number };
  portal: { available: boolean; context_count: number };
  default_workspace?: "admin" | "ceph-admin" | "storage-ops" | "manager" | "portal" | "browser" | null;
};

export async function getWorkspaceAccess(): Promise<WorkspaceAccess> {
  const { data } = await client.get<WorkspaceAccess>("/me/workspace-access", {
    timeout: timeoutForRequestProfile("interactive"),
  });
  return data;
}

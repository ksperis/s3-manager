/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type ExecutionContextKind = "account" | "connection" | "legacy_user";

export type ExecutionContextCapabilities = {
  can_manage_iam: boolean;
  sts_capable: boolean;
  admin_api_capable: boolean;
};

export type ExecutionContext = {
  kind: ExecutionContextKind;
  id: string;
  display_name: string;
  hidden?: boolean;
  rgw_account_id?: string | null;
  quota_max_size_gb?: number | null;
  quota_max_objects?: number | null;
  endpoint_id?: number | null;
  endpoint_name?: string | null;
  endpoint_provider?: "ceph" | "other" | null;
  endpoint_url?: string | null;
  storage_endpoint_capabilities?: Record<string, boolean> | null;
  capabilities: ExecutionContextCapabilities;
};

export type ExecutionWorkspace = "manager" | "browser";

export async function listExecutionContexts(workspace?: ExecutionWorkspace): Promise<ExecutionContext[]> {
  const { data } = await client.get<ExecutionContext[]>("/me/execution-contexts", {
    params: workspace ? { workspace } : undefined,
  });
  return data;
}

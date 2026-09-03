/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client, { timeoutForRequestProfile } from "./client";
import type { TagDefinitionSummary } from "./tags";

export type CephAdminEndpoint = {
  id: number;
  name: string;
  endpoint_url: string;
  admin_endpoint?: string | null;
  region?: string | null;
  is_default: boolean;
  capabilities?: Record<string, boolean>;
  tags: TagDefinitionSummary[];
};

export type CephAdminEndpointAccess = {
  endpoint_id: number;
  can_admin: boolean;
  can_accounts: boolean;
  can_metrics: boolean;
  admin_warning?: string | null;
  accounts_warning?: string | null;
  active_rgw_uid?: string | null;
  active_rgw_tenant?: string | null;
  availability_status?:
    | "unknown"
    | "available"
    | "unavailable"
    | "denied"
    | "misconfigured";
  availability_checked_at?: string | null;
};

export async function listCephAdminEndpoints(): Promise<CephAdminEndpoint[]> {
  const { data } = await client.get<CephAdminEndpoint[]>(
    "/ceph-admin/endpoints",
    { timeout: timeoutForRequestProfile("interactive") },
  );
  return data;
}

export async function getCephAdminEndpointAccess(
  endpointId: number,
  options?: { probe?: boolean; signal?: AbortSignal },
): Promise<CephAdminEndpointAccess> {
  const { data } = await client.get<CephAdminEndpointAccess>(
    `/ceph-admin/endpoints/${endpointId}/access`,
    {
      params: options?.probe ? { probe: true } : undefined,
      signal: options?.signal,
      timeout: timeoutForRequestProfile("interactive"),
    },
  );
  return data;
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type PortalRoleKey = "Viewer" | "AccessAdmin" | "AccountAdmin";

export type PortalEndpointCapabilities = {
  sts_enabled: boolean;
  presign_enabled: boolean;
  allow_external_access: boolean;
  max_session_duration: number;
  allowed_packages: string[];
};

export type PortalAccountListItem = {
  id: number;
  name: string;
  portal_role: PortalRoleKey;
  access_mode: "portal_only" | "external_enabled";
  integrated_mode: "sts" | "presigned";
  storage_endpoint_id?: number | null;
  storage_endpoint_name?: string | null;
  storage_endpoint_url?: string | null;
  endpoint: PortalEndpointCapabilities;
  external_enabled: boolean;
};

export type PortalContextResponse = {
  account_id: number;
  account_name: string;
  portal_role: PortalRoleKey;
  permissions: string[];
  endpoint: PortalEndpointCapabilities;
  external_enabled: boolean;
};

export type PortalMember = {
  user_id: number;
  email: string;
  portal_role: PortalRoleKey;
  external_enabled: boolean;
};

export type PortalMemberRoleUpdate = {
  role_key: PortalRoleKey;
};

export async function listPortalAccounts(): Promise<PortalAccountListItem[]> {
  const { data } = await client.get<PortalAccountListItem[]>("/portal/accounts");
  return data;
}

export async function fetchPortalContext(accountId: S3AccountSelector): Promise<PortalContextResponse> {
  const { data } = await client.get<PortalContextResponse>("/portal/context", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function listPortalMembers(accountId: S3AccountSelector): Promise<PortalMember[]> {
  const { data } = await client.get<PortalMember[]>("/portal/members", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function updatePortalMemberRole(
  accountId: S3AccountSelector,
  userId: number,
  roleKey: PortalRoleKey
): Promise<PortalMember> {
  const payload: PortalMemberRoleUpdate = { role_key: roleKey };
  const { data } = await client.put<PortalMember>(`/portal/members/${userId}/role`, payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export type PortalAuditLogEntry = {
  id: number;
  created_at: string;
  user_email: string;
  user_role: string;
  scope: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  account_id?: number | null;
  account_name?: string | null;
  status: string;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type PortalAuditLogResponse = {
  logs: PortalAuditLogEntry[];
  next_cursor?: number | null;
};

export type PortalAuditLogQuery = {
  limit?: number;
  cursor?: number | null;
  search?: string;
};

export async function listPortalAuditLogs(
  accountId: S3AccountSelector,
  params?: PortalAuditLogQuery
): Promise<PortalAuditLogResponse> {
  const { data } = await client.get<PortalAuditLogResponse>("/portal/audit/logs", {
    params: withS3AccountParam(params ?? undefined, accountId),
  });
  return data;
}

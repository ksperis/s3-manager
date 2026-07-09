/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";

export type PortalAdminRequestType = "portal_user_access" | "portal_user_removal" | "account_quota_change";
export type PortalAdminRequestStatus = "pending" | "processing" | "approved" | "rejected" | "failed";
export type PortalQuotaDirection = "increase" | "decrease";
export type PortalQuotaUnit = "MiB" | "GiB" | "TiB";

export type PortalUserAccessRequestCreate = {
  request_type: "portal_user_access";
  target_name: string;
  target_email: string;
  reason?: string | null;
};

export type PortalUserRemovalRequestCreate = {
  request_type: "portal_user_removal";
  target_email: string;
  target_name?: string | null;
  reason?: string | null;
};

export type PortalAccountQuotaChangeRequestCreate = {
  request_type: "account_quota_change";
  direction: PortalQuotaDirection;
  target_quota_value: number;
  target_quota_unit: PortalQuotaUnit;
  reason?: string | null;
};

export type PortalAdminRequestCreate =
  | PortalUserAccessRequestCreate
  | PortalUserRemovalRequestCreate
  | PortalAccountQuotaChangeRequestCreate;

export type PortalAdminRequestMessage = {
  id: number;
  author_user_id?: number | null;
  author_email: string;
  author_role?: string | null;
  message: string;
  created_at: string;
};

export type PortalAdminRequest = {
  id: number;
  account_id: number;
  account_name?: string | null;
  request_type: PortalAdminRequestType;
  status: PortalAdminRequestStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error_message?: string | null;
  requester_user_id?: number | null;
  requester_email: string;
  decided_by_user_id?: number | null;
  decided_by_email?: string | null;
  decided_at?: string | null;
  created_at: string;
  updated_at: string;
  messages: PortalAdminRequestMessage[];
};

export type AdminPortalRequestListParams = {
  status?: PortalAdminRequestStatus | "all";
  request_type?: PortalAdminRequestType | "all";
  account_id?: number | "all";
  search?: string;
  limit?: number;
};

export async function listPortalRequests(
  accountId: S3AccountSelector,
  options?: { status?: PortalAdminRequestStatus }
): Promise<PortalAdminRequest[]> {
  const { data } = await client.get<PortalAdminRequest[]>("/portal/requests", {
    params: withS3AccountParam(options?.status ? { status: options.status } : undefined, accountId),
  });
  return data;
}

export async function createPortalRequest(
  accountId: S3AccountSelector,
  payload: PortalAdminRequestCreate
): Promise<PortalAdminRequest> {
  const { data } = await client.post<PortalAdminRequest>("/portal/requests", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function getPortalRequest(
  accountId: S3AccountSelector,
  requestId: number
): Promise<PortalAdminRequest> {
  const { data } = await client.get<PortalAdminRequest>(`/portal/requests/${requestId}`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function listAdminPortalRequests(
  params?: AdminPortalRequestListParams
): Promise<PortalAdminRequest[]> {
  const query = {
    status: params?.status && params.status !== "all" ? params.status : undefined,
    request_type: params?.request_type && params.request_type !== "all" ? params.request_type : undefined,
    account_id: params?.account_id && params.account_id !== "all" ? params.account_id : undefined,
    search: params?.search?.trim() || undefined,
    limit: params?.limit,
  };
  const { data } = await client.get<PortalAdminRequest[]>("/admin/portal-requests", { params: query });
  return data;
}

export async function getAdminPortalRequest(requestId: number): Promise<PortalAdminRequest> {
  const { data } = await client.get<PortalAdminRequest>(`/admin/portal-requests/${requestId}`);
  return data;
}

export async function approveAdminPortalRequest(
  requestId: number,
  payload?: { message?: string | null }
): Promise<PortalAdminRequest> {
  const { data } = await client.post<PortalAdminRequest>(
    `/admin/portal-requests/${requestId}/approve`,
    payload ?? {}
  );
  return data;
}

export async function rejectAdminPortalRequest(
  requestId: number,
  payload?: { message?: string | null }
): Promise<PortalAdminRequest> {
  const { data } = await client.post<PortalAdminRequest>(
    `/admin/portal-requests/${requestId}/reject`,
    payload ?? {}
  );
  return data;
}

export async function addAdminPortalRequestMessage(
  requestId: number,
  payload: { message: string }
): Promise<PortalAdminRequest> {
  const { data } = await client.post<PortalAdminRequest>(
    `/admin/portal-requests/${requestId}/messages`,
    payload
  );
  return data;
}

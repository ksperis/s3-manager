/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";
import client, { LONG_RUNNING_REQUEST_TIMEOUT_MS } from "./client";
import { filenameFromContentDisposition } from "./contentDisposition";

export type PortalActivityItem = {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  target: string;
  storage_space_id?: string | null;
  storage_space_name?: string | null;
  ip_address?: string | null;
  status: string;
};

export type PortalServerAccessRequesterIdentity = {
  label: string;
  kind: "portal_user" | "external_access" | "rgw_user" | "rgw_account" | "unknown";
  detail?: string | null;
  access_key_id?: string | null;
  iam_username?: string | null;
  user_id?: number | null;
  email?: string | null;
  resolved: boolean;
};

export type PortalServerAccessLogEntry = {
  id: string;
  source: "server_access_logging";
  timestamp: string;
  storage_space_id?: string | null;
  storage_space_name?: string | null;
  bucket_name: string;
  operation: string;
  operation_category: "upload" | "download" | "delete" | "metadata" | "list" | "other";
  object_key?: string | null;
  object_name?: string | null;
  direction?: "Upload" | "Download" | null;
  status_code?: number | null;
  error_code?: string | null;
  bytes_sent?: number | null;
  object_size?: number | null;
  requester?: string | null;
  requester_identity?: PortalServerAccessRequesterIdentity | null;
  client_ip?: string | null;
  auth_type?: string | null;
  request_id?: string | null;
  request_uri?: string | null;
  user_agent?: string | null;
  log_object_key: string;
};

type PortalServerAccessLogPage = {
  entries: PortalServerAccessLogEntry[];
  total: number;
  limit: number;
  offset: number;
};

type PortalServerAccessRawLogsDownload = {
  blob: Blob;
  filename: string;
};

export type PortalAlert = {
  id: string;
  tone: "info" | "warning" | "danger";
  title: string;
  description: string;
  severity_label: string;
  storage_space_id?: string | null;
  created_at?: string | null;
};

export async function fetchPortalActivity(
  accountId: S3AccountSelector,
  options?: { spaceId?: string; limit?: number },
): Promise<PortalActivityItem[]> {
  const baseParams: Record<string, string | number> = {};
  if (options?.spaceId) baseParams.space_id = options.spaceId;
  if (options?.limit) baseParams.limit = options.limit;
  const { data } = await client.get<PortalActivityItem[]>("/portal/activity", {
    params: withS3AccountParam(baseParams, accountId),
  });
  return data;
}

export async function fetchPortalServerAccessLogPage(
  accountId: S3AccountSelector,
  options: {
    date: string;
    spaceId?: string;
    limit?: number;
    offset?: number;
    timezoneOffsetMinutes?: number;
    advancedFilter?: string;
  },
): Promise<PortalServerAccessLogPage> {
  const baseParams: Record<string, string | number> = {
    date: options.date,
    limit: options.limit ?? 200,
    offset: options.offset ?? 0,
    timezone_offset_minutes:
      options.timezoneOffsetMinutes ?? new Date().getTimezoneOffset(),
  };
  if (options.spaceId) baseParams.space_id = options.spaceId;
  if (options.advancedFilter) baseParams.advanced_filter = options.advancedFilter;
  const { data } = await client.get<PortalServerAccessLogPage>(
    "/portal/access-logs/page",
    { params: withS3AccountParam(baseParams, accountId) },
  );
  return data;
}

export async function downloadPortalServerAccessRawLogs(
  accountId: S3AccountSelector,
  options: {
    dateFrom: string;
    dateTo: string;
    spaceId?: string;
    timezoneOffsetMinutes?: number;
  },
): Promise<PortalServerAccessRawLogsDownload> {
  const baseParams: Record<string, string | number> = {
    date_from: options.dateFrom,
    date_to: options.dateTo,
    timezone_offset_minutes:
      options.timezoneOffsetMinutes ?? new Date().getTimezoneOffset(),
  };
  if (options.spaceId) baseParams.space_id = options.spaceId;
  const response = await client.get<Blob>("/portal/access-logs/raw", {
    params: withS3AccountParam(baseParams, accountId),
    responseType: "blob",
    timeout: LONG_RUNNING_REQUEST_TIMEOUT_MS,
  });
  const fallback =
    options.dateFrom === options.dateTo
      ? `portal-server-access-logs-${options.dateFrom}.log`
      : `portal-server-access-logs-${options.dateFrom}-${options.dateTo}.log`;
  return {
    blob: response.data,
    filename: filenameFromContentDisposition(
      response.headers?.["content-disposition"],
      fallback,
    ),
  };
}

export async function fetchPortalAlerts(
  accountId: S3AccountSelector,
  limit = 50,
): Promise<PortalAlert[]> {
  const { data } = await client.get<PortalAlert[]>("/portal/alerts", {
    params: withS3AccountParam({ limit }, accountId),
  });
  return data;
}

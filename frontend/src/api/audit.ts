/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type AuditLogEntry = {
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

export type AuditLogResponse = {
  logs: AuditLogEntry[];
  next_cursor?: number | null;
};

export type AuditLogQuery = {
  limit?: number;
  cursor?: number | null;
  role?: string;
  scope?: string;
  account_id?: number;
};

export async function listAuditLogs(params?: AuditLogQuery): Promise<AuditLogResponse> {
  const { data } = await client.get<AuditLogResponse>("/admin/audit/logs", { params });
  return data;
}

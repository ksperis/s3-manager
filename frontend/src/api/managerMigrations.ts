/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type BucketMigrationMode = "one_shot" | "pre_sync";
export type BucketMigrationStatus =
  | "draft"
  | "queued"
  | "running"
  | "pause_requested"
  | "paused"
  | "awaiting_cutover"
  | "cancel_requested"
  | "canceled"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "rolled_back";
export type BucketMigrationPrecheckStatus = "pending" | "passed" | "failed";

export type BucketMigrationItemStatus =
  | "pending"
  | "running"
  | "awaiting_cutover"
  | "paused"
  | "skipped"
  | "completed"
  | "failed"
  | "canceled";

export type BucketMigrationBucketMapping = {
  source_bucket: string;
  target_bucket?: string | null;
};

export type BucketMigrationCreateRequest = {
  source_context_id: string;
  target_context_id: string;
  buckets: BucketMigrationBucketMapping[];
  mapping_prefix?: string;
  mode?: BucketMigrationMode;
  copy_bucket_settings?: boolean;
  delete_source?: boolean;
  lock_target_writes?: boolean;
  auto_grant_source_read_for_copy?: boolean;
  webhook_url?: string;
  parallelism_max?: number;
};

export type BucketMigrationItemView = {
  id: number;
  source_bucket: string;
  target_bucket: string;
  status: BucketMigrationItemStatus;
  step: string;
  pre_sync_done: boolean;
  read_only_applied: boolean;
  target_lock_applied: boolean;
  target_bucket_exists: boolean;
  objects_copied: number;
  objects_deleted: number;
  source_count?: number | null;
  target_count?: number | null;
  matched_count?: number | null;
  different_count?: number | null;
  only_source_count?: number | null;
  only_target_count?: number | null;
  diff_sample?: Record<string, unknown> | null;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type BucketMigrationEventView = {
  id: number;
  item_id?: number | null;
  level: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type BucketMigrationView = {
  id: number;
  created_by_user_id?: number | null;
  source_context_id: string;
  target_context_id: string;
  mode: BucketMigrationMode;
  copy_bucket_settings: boolean;
  delete_source: boolean;
  lock_target_writes: boolean;
  auto_grant_source_read_for_copy: boolean;
  webhook_url?: string | null;
  mapping_prefix?: string | null;
  status: BucketMigrationStatus;
  pause_requested: boolean;
  cancel_requested: boolean;
  precheck_status: BucketMigrationPrecheckStatus;
  precheck_report?: Record<string, unknown> | null;
  precheck_checked_at?: string | null;
  parallelism_max: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  skipped_items: number;
  awaiting_items: number;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  last_heartbeat_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type BucketMigrationDetail = BucketMigrationView & {
  items: BucketMigrationItemView[];
  recent_events: BucketMigrationEventView[];
};

export type BucketMigrationListResponse = {
  items: BucketMigrationView[];
};

export type BucketMigrationActionResponse = {
  id: number;
  status: BucketMigrationStatus;
  message: string;
};

export async function listManagerMigrations(limit = 100, contextId?: string | null): Promise<BucketMigrationView[]> {
  const params: { limit: number; context_id?: string } = { limit };
  if (contextId && contextId.trim()) {
    params.context_id = contextId.trim();
  }
  const { data } = await client.get<BucketMigrationListResponse>("/manager/migrations", { params });
  return data.items || [];
}

export async function getManagerMigration(migrationId: number, eventsLimit = 200): Promise<BucketMigrationDetail> {
  const { data } = await client.get<BucketMigrationDetail>(`/manager/migrations/${migrationId}`, {
    params: { events_limit: eventsLimit },
  });
  return data;
}

export async function deleteManagerMigration(migrationId: number): Promise<void> {
  await client.delete(`/manager/migrations/${migrationId}`);
}

export async function createManagerMigration(payload: BucketMigrationCreateRequest): Promise<BucketMigrationDetail> {
  const { data } = await client.post<BucketMigrationDetail>("/manager/migrations", payload);
  return data;
}

export async function updateManagerMigration(
  migrationId: number,
  payload: BucketMigrationCreateRequest
): Promise<BucketMigrationDetail> {
  const { data } = await client.patch<BucketMigrationDetail>(`/manager/migrations/${migrationId}`, payload);
  return data;
}

export async function runManagerMigrationPrecheck(migrationId: number): Promise<BucketMigrationDetail> {
  const { data } = await client.post<BucketMigrationDetail>(`/manager/migrations/${migrationId}/precheck`);
  return data;
}

export async function startManagerMigration(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/start`);
  return data;
}

export async function pauseManagerMigration(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/pause`);
  return data;
}

export async function resumeManagerMigration(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/resume`);
  return data;
}

export async function stopManagerMigration(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/stop`);
  return data;
}

export async function continueManagerMigration(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/continue`);
  return data;
}

export async function rollbackManagerMigration(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/rollback`);
  return data;
}

export async function retryManagerMigrationItem(
  migrationId: number,
  itemId: number
): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/items/${itemId}/retry`);
  return data;
}

export async function rollbackManagerMigrationItem(
  migrationId: number,
  itemId: number
): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(
    `/manager/migrations/${migrationId}/items/${itemId}/rollback`
  );
  return data;
}

export async function retryFailedManagerMigrationItems(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/items/retry-failed`);
  return data;
}

export async function rollbackFailedManagerMigrationItems(migrationId: number): Promise<BucketMigrationActionResponse> {
  const { data } = await client.post<BucketMigrationActionResponse>(`/manager/migrations/${migrationId}/items/rollback-failed`);
  return data;
}

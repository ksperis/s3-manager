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
  use_same_endpoint_copy?: boolean;
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
  use_same_endpoint_copy: boolean;
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

export type ManagerMigrationStreamDone = {
  migration_id: number;
  status: BucketMigrationStatus;
  reason: string;
};

type ManagerMigrationStreamOptions = {
  eventsLimit?: number;
  signal?: AbortSignal;
  onSnapshot?: (detail: BucketMigrationDetail) => void;
  onDone?: (event: ManagerMigrationStreamDone) => void;
};

function resolveApiBaseUrl(): string {
  const base = typeof client.defaults.baseURL === "string" && client.defaults.baseURL.trim() ? client.defaults.baseURL : "/api";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function isCancelledError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (typeof err !== "object" || err === null) return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  return name === "CanceledError" || code === "ERR_CANCELED";
}

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

export async function streamManagerMigration(
  migrationId: number,
  options?: ManagerMigrationStreamOptions
): Promise<BucketMigrationDetail> {
  const baseUrl = resolveApiBaseUrl();
  const query = new URLSearchParams();
  query.set("events_limit", String(Math.max(1, Math.min(1000, Math.floor(options?.eventsLimit ?? 200)))));
  const url = `${baseUrl}/manager/migrations/${migrationId}/stream?${query.toString()}`;

  const buildHeaders = () => {
    const headers = new Headers({ Accept: "text/event-stream" });
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  };

  let response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(),
    credentials: "include",
    signal: options?.signal,
  });

  if (response.status === 401 || response.status === 419) {
    try {
      const refresh = await client.post<{ access_token: string; token_type: string }>(
        "/auth/refresh",
        undefined,
        { signal: options?.signal }
      );
      if (typeof window !== "undefined") {
        localStorage.setItem("token", refresh.data.access_token);
      }
      response = await fetch(url, {
        method: "GET",
        headers: buildHeaders(),
        credentials: "include",
        signal: options?.signal,
      });
    } catch (err) {
      if (isCancelledError(err)) throw err;
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Migration stream failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`Unexpected stream response content type: ${contentType}`);
  }
  if (!response.body) {
    throw new Error("Streaming response body is unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let currentDataLines: string[] = [];
  let latestSnapshot: BucketMigrationDetail | null = null;

  const handleEvent = () => {
    if (currentDataLines.length === 0) {
      currentEvent = "message";
      return;
    }
    const payloadText = currentDataLines.join("\n");
    currentDataLines = [];
    const payload = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};
    if (currentEvent === "snapshot") {
      const detail = payload as unknown as BucketMigrationDetail;
      latestSnapshot = detail;
      options?.onSnapshot?.(detail);
    } else if (currentEvent === "done") {
      options?.onDone?.(payload as unknown as ManagerMigrationStreamDone);
    } else if (currentEvent === "error") {
      const detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
      throw new Error(detail || "Migration stream failed");
    }
    currentEvent = "message";
  };

  const processLine = (line: string) => {
    if (line === "") {
      handleEvent();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim() || "message";
      return;
    }
    if (line.startsWith("data:")) {
      currentDataLines.push(line.slice(5).trimStart());
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      processLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
    if (done) {
      if (buffer.length > 0) {
        processLine(buffer);
      }
      processLine("");
      break;
    }
  }

  if (!latestSnapshot) {
    throw new Error("Migration stream ended without a snapshot payload");
  }
  return latestSnapshot;
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

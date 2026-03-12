/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { PaginatedResponse } from "./types";
import type { ManagerTrafficStats, TrafficWindow } from "./stats";
import type {
  BucketFeatureStatus,
  BucketLoggingConfiguration,
  BucketNotificationConfiguration,
  BucketQuotaUpdate,
  BucketTag,
  BucketWebsiteConfiguration,
} from "./buckets";

export type CephAdminEndpoint = {
  id: number;
  name: string;
  endpoint_url: string;
  admin_endpoint?: string | null;
  region?: string | null;
  is_default: boolean;
  capabilities?: Record<string, boolean>;
};

export type CephAdminEndpointAccess = {
  endpoint_id: number;
  can_admin: boolean;
  can_accounts: boolean;
  can_metrics: boolean;
  admin_warning?: string | null;
};

export type CephAdminPlacementTarget = {
  name: string;
  storage_classes: string[];
};

export type CephAdminEndpointInfo = {
  default_placement?: string | null;
  zonegroup?: string | null;
  realm?: string | null;
  placement_targets: CephAdminPlacementTarget[];
  storage_classes: string[];
};

export type CephAdminRgwAccount = {
  account_id: string;
  account_name?: string | null;
  email?: string | null;
  max_users?: number | null;
  max_buckets?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  bucket_count?: number | null;
  user_count?: number | null;
};

export type CephAdminRgwQuotaConfig = {
  enabled?: boolean | null;
  max_size_bytes?: number | null;
  max_objects?: number | null;
};

export type CephAdminBucketUsagePoint = {
  name: string;
  used_bytes?: number | null;
  object_count?: number | null;
};

export type CephAdminEntityMetrics = {
  total_bytes?: number | null;
  total_objects?: number | null;
  bucket_count: number;
  bucket_usage: CephAdminBucketUsagePoint[];
  generated_at: string;
};

export type CephAdminClusterOwnerUsagePoint = {
  owner: string;
  used_bytes?: number | null;
  object_count?: number | null;
  bucket_count: number;
};

export type CephAdminClusterStorageTotals = {
  used_bytes?: number | null;
  object_count?: number | null;
  bucket_count?: number | null;
  owners_with_usage?: number | null;
};

export type CephAdminClusterStorageMetrics = {
  total_buckets: number;
  bucket_usage: CephAdminBucketUsagePoint[];
  owner_usage: CephAdminClusterOwnerUsagePoint[];
  storage_totals: CephAdminClusterStorageTotals;
  generated_at: string;
};

export type CephAdminClusterTrafficMetrics = ManagerTrafficStats;

export type CephAdminRgwAccountDetail = {
  account_id: string;
  account_name?: string | null;
  email?: string | null;
  max_users?: number | null;
  max_buckets?: number | null;
  max_roles?: number | null;
  max_groups?: number | null;
  max_access_keys?: number | null;
  bucket_count?: number | null;
  user_count?: number | null;
  quota?: CephAdminRgwQuotaConfig | null;
  bucket_quota?: CephAdminRgwQuotaConfig | null;
};

export type UpdateCephAdminAccountPayload = {
  account_name?: string | null;
  email?: string | null;
  max_users?: number | null;
  max_buckets?: number | null;
  max_roles?: number | null;
  max_groups?: number | null;
  max_access_keys?: number | null;
  quota_enabled?: boolean | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  bucket_quota_enabled?: boolean | null;
  bucket_quota_max_size_bytes?: number | null;
  bucket_quota_max_objects?: number | null;
  extra_params?: Record<string, unknown>;
};

export type CreateCephAdminAccountPayload = {
  account_id?: string | null;
  account_name: string;
  email?: string | null;
  max_users?: number | null;
  max_buckets?: number | null;
  max_roles?: number | null;
  max_groups?: number | null;
  max_access_keys?: number | null;
  quota_enabled?: boolean | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  bucket_quota_enabled?: boolean | null;
  bucket_quota_max_size_bytes?: number | null;
  bucket_quota_max_objects?: number | null;
  extra_params?: Record<string, unknown>;
};

export type CreateCephAdminAccountResponse = {
  account: CephAdminRgwAccountDetail;
};

export type PaginatedCephAdminAccountsResponse = PaginatedResponse<CephAdminRgwAccount>;

export type ListCephAdminAccountsParams = {
  page?: number;
  page_size?: number;
  search?: string;
  advanced_filter?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include?: string[];
};

export async function listCephAdminEndpoints(): Promise<CephAdminEndpoint[]> {
  const { data } = await client.get<CephAdminEndpoint[]>("/ceph-admin/endpoints");
  return data;
}

export async function getCephAdminEndpointAccess(endpointId: number): Promise<CephAdminEndpointAccess> {
  const { data } = await client.get<CephAdminEndpointAccess>(`/ceph-admin/endpoints/${endpointId}/access`);
  return data;
}

export async function listCephAdminAccounts(
  endpointId: number,
  params?: ListCephAdminAccountsParams
): Promise<PaginatedCephAdminAccountsResponse> {
  const { data } = await client.get<PaginatedCephAdminAccountsResponse>(`/ceph-admin/endpoints/${endpointId}/accounts`, {
    params: {
      ...params,
      include: params?.include?.join(","),
    },
  });
  return data;
}

export async function getCephAdminAccountDetail(endpointId: number, accountId: string): Promise<CephAdminRgwAccountDetail> {
  const { data } = await client.get<CephAdminRgwAccountDetail>(
    `/ceph-admin/endpoints/${endpointId}/accounts/${encodeURIComponent(accountId)}/detail`
  );
  return data;
}

export async function createCephAdminAccount(
  endpointId: number,
  payload: CreateCephAdminAccountPayload
): Promise<CreateCephAdminAccountResponse> {
  const { data } = await client.post<CreateCephAdminAccountResponse>(`/ceph-admin/endpoints/${endpointId}/accounts`, payload);
  return data;
}

export async function updateCephAdminAccountConfig(
  endpointId: number,
  accountId: string,
  payload: UpdateCephAdminAccountPayload
): Promise<CephAdminRgwAccountDetail> {
  const { data } = await client.put<CephAdminRgwAccountDetail>(
    `/ceph-admin/endpoints/${endpointId}/accounts/${encodeURIComponent(accountId)}/config`,
    payload
  );
  return data;
}

export async function getCephAdminAccountMetrics(endpointId: number, accountId: string): Promise<CephAdminEntityMetrics> {
  const { data } = await client.get<CephAdminEntityMetrics>(
    `/ceph-admin/endpoints/${endpointId}/accounts/${encodeURIComponent(accountId)}/metrics`
  );
  return data;
}

export async function fetchCephAdminClusterStorage(endpointId: number): Promise<CephAdminClusterStorageMetrics> {
  const { data } = await client.get<CephAdminClusterStorageMetrics>(`/ceph-admin/endpoints/${endpointId}/metrics/storage`);
  return data;
}

export async function fetchCephAdminClusterTraffic(
  endpointId: number,
  window: TrafficWindow = "week",
  bucket?: string
): Promise<CephAdminClusterTrafficMetrics> {
  const { data } = await client.get<CephAdminClusterTrafficMetrics>(`/ceph-admin/endpoints/${endpointId}/metrics/traffic`, {
    params: { window, bucket: bucket || undefined },
  });
  return data;
}

export type CephAdminRgwUser = {
  uid: string;
  tenant?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  suspended?: boolean | null;
  max_buckets?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
};

export type CephAdminRgwAccessKey = {
  access_key: string;
  secret_key?: string | null;
  status?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  user?: string | null;
  subuser?: string | null;
};

export type CephAdminRgwGeneratedAccessKey = {
  access_key: string;
  secret_key: string;
};

export type CephAdminRgwUserCapsUpdate = {
  mode?: "replace" | "add" | "remove";
  values: string[];
};

export type CephAdminRgwUserDetail = {
  uid: string;
  tenant?: string | null;
  display_name?: string | null;
  email?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  suspended?: boolean | null;
  admin?: boolean | null;
  system?: boolean | null;
  account_root?: boolean | null;
  max_buckets?: number | null;
  op_mask?: string | null;
  default_placement?: string | null;
  default_storage_class?: string | null;
  caps: string[];
  quota?: CephAdminRgwQuotaConfig | null;
  keys: CephAdminRgwAccessKey[];
};

export type UpdateCephAdminUserPayload = {
  display_name?: string | null;
  email?: string | null;
  suspended?: boolean | null;
  max_buckets?: number | null;
  op_mask?: string | null;
  admin?: boolean | null;
  system?: boolean | null;
  account_root?: boolean | null;
  quota_enabled?: boolean | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  caps?: CephAdminRgwUserCapsUpdate | null;
  extra_params?: Record<string, unknown>;
};

export type CreateCephAdminUserPayload = {
  uid: string;
  tenant?: string | null;
  account_id?: string | null;
  display_name?: string | null;
  email?: string | null;
  suspended?: boolean | null;
  max_buckets?: number | null;
  op_mask?: string | null;
  admin?: boolean | null;
  system?: boolean | null;
  account_root?: boolean | null;
  generate_key?: boolean;
  quota_enabled?: boolean | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  caps?: CephAdminRgwUserCapsUpdate | null;
  extra_params?: Record<string, unknown>;
};

export type CreateCephAdminUserResponse = {
  detail: CephAdminRgwUserDetail;
  generated_key?: CephAdminRgwGeneratedAccessKey | null;
};

export type PaginatedCephAdminUsersResponse = PaginatedResponse<CephAdminRgwUser>;

export type ListCephAdminUsersParams = {
  page?: number;
  page_size?: number;
  search?: string;
  advanced_filter?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include?: string[];
};

export async function listCephAdminUsers(
  endpointId: number,
  params?: ListCephAdminUsersParams
): Promise<PaginatedCephAdminUsersResponse> {
  const { data } = await client.get<PaginatedCephAdminUsersResponse>(`/ceph-admin/endpoints/${endpointId}/users`, {
    params: {
      ...params,
      include: params?.include?.join(","),
    },
  });
  return data;
}

export async function createCephAdminUser(
  endpointId: number,
  payload: CreateCephAdminUserPayload
): Promise<CreateCephAdminUserResponse> {
  const { data } = await client.post<CreateCephAdminUserResponse>(`/ceph-admin/endpoints/${endpointId}/users`, payload);
  return data;
}

export async function getCephAdminUserDetail(
  endpointId: number,
  uid: string,
  tenant?: string | null
): Promise<CephAdminRgwUserDetail> {
  const { data } = await client.get<CephAdminRgwUserDetail>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/detail`,
    { params: tenant ? { tenant } : undefined }
  );
  return data;
}

export async function updateCephAdminUserConfig(
  endpointId: number,
  uid: string,
  payload: UpdateCephAdminUserPayload,
  tenant?: string | null
): Promise<CephAdminRgwUserDetail> {
  const { data } = await client.put<CephAdminRgwUserDetail>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/config`,
    payload,
    { params: tenant ? { tenant } : undefined }
  );
  return data;
}

export async function getCephAdminUserMetrics(
  endpointId: number,
  uid: string,
  tenant?: string | null
): Promise<CephAdminEntityMetrics> {
  const { data } = await client.get<CephAdminEntityMetrics>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/metrics`,
    { params: tenant ? { tenant } : undefined }
  );
  return data;
}

export async function listCephAdminUserKeys(
  endpointId: number,
  uid: string,
  tenant?: string | null
): Promise<CephAdminRgwAccessKey[]> {
  const { data } = await client.get<CephAdminRgwAccessKey[]>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/keys`,
    { params: tenant ? { tenant } : undefined }
  );
  return data;
}

export async function createCephAdminUserKey(
  endpointId: number,
  uid: string,
  tenant?: string | null
): Promise<CephAdminRgwGeneratedAccessKey> {
  const { data } = await client.post<CephAdminRgwGeneratedAccessKey>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/keys`,
    undefined,
    { params: tenant ? { tenant } : undefined }
  );
  return data;
}

export async function updateCephAdminUserKeyStatus(
  endpointId: number,
  uid: string,
  accessKey: string,
  active: boolean,
  tenant?: string | null
): Promise<CephAdminRgwAccessKey> {
  const { data } = await client.put<CephAdminRgwAccessKey>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/keys/${encodeURIComponent(accessKey)}/status`,
    { active },
    { params: tenant ? { tenant } : undefined }
  );
  return data;
}

export async function deleteCephAdminUserKey(
  endpointId: number,
  uid: string,
  accessKey: string,
  tenant?: string | null
): Promise<void> {
  await client.delete(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/keys/${encodeURIComponent(accessKey)}`,
    { params: tenant ? { tenant } : undefined }
  );
}

export type CephAdminBucket = {
  name: string;
  bucket_name?: string | null;
  tenant?: string | null;
  owner?: string | null;
  owner_name?: string | null;
  context_id?: string | null;
  context_name?: string | null;
  context_kind?: "account" | "connection" | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  tags?: BucketTag[] | null;
  features?: Record<string, BucketFeatureStatus> | null;
  column_details?: Record<string, unknown> | null;
};

export type PaginatedCephAdminBucketsResponse = PaginatedResponse<CephAdminBucket>;

export type ListCephAdminBucketsParams = {
  page?: number;
  page_size?: number;
  filter?: string;
  advanced_filter?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  include?: string[];
  with_stats?: boolean;
};

export type CephAdminBucketsStreamProgress = {
  request_id: string;
  percent: number;
  stage: string;
  processed: number;
  total: number;
  message?: string;
};

type CephAdminBucketsStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (event: CephAdminBucketsStreamProgress) => void;
};

type ListCephAdminBucketsOptions = {
  signal?: AbortSignal;
};

function buildCephAdminBucketsQuery(params?: ListCephAdminBucketsParams): URLSearchParams {
  const query = new URLSearchParams();
  if (!params) return query;
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.page_size !== undefined) query.set("page_size", String(params.page_size));
  if (typeof params.filter === "string" && params.filter.trim().length > 0) query.set("filter", params.filter);
  if (typeof params.advanced_filter === "string" && params.advanced_filter.trim().length > 0) {
    query.set("advanced_filter", params.advanced_filter);
  }
  if (typeof params.sort_by === "string" && params.sort_by.trim().length > 0) query.set("sort_by", params.sort_by);
  if (typeof params.sort_dir === "string" && params.sort_dir.trim().length > 0) query.set("sort_dir", params.sort_dir);
  if (Array.isArray(params.include) && params.include.length > 0) query.set("include", params.include.join(","));
  if (params.with_stats !== undefined) query.set("with_stats", params.with_stats ? "true" : "false");
  return query;
}

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

export async function listCephAdminBuckets(
  endpointId: number,
  params?: ListCephAdminBucketsParams,
  options?: ListCephAdminBucketsOptions
): Promise<PaginatedCephAdminBucketsResponse> {
  const { data } = await client.get<PaginatedCephAdminBucketsResponse>(`/ceph-admin/endpoints/${endpointId}/buckets`, {
    params: {
      ...params,
      include: params?.include?.join(","),
    },
    signal: options?.signal,
  });
  return data;
}

export async function streamCephAdminBuckets(
  endpointId: number,
  params?: ListCephAdminBucketsParams,
  options?: CephAdminBucketsStreamOptions
): Promise<PaginatedCephAdminBucketsResponse> {
  const baseUrl = resolveApiBaseUrl();
  const query = buildCephAdminBucketsQuery(params);
  const queryText = query.toString();
  const url = `${baseUrl}/ceph-admin/endpoints/${endpointId}/buckets/stream${queryText ? `?${queryText}` : ""}`;

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
    throw new Error(text || `Advanced search stream failed with status ${response.status}`);
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
  let resultPayload: PaginatedCephAdminBucketsResponse | null = null;

  const handleEvent = () => {
    if (currentDataLines.length === 0) {
      currentEvent = "message";
      return;
    }
    const payloadText = currentDataLines.join("\n");
    currentDataLines = [];
    const payload = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};
    if (currentEvent === "progress") {
      options?.onProgress?.(payload as unknown as CephAdminBucketsStreamProgress);
    } else if (currentEvent === "result") {
      resultPayload = payload as unknown as PaginatedCephAdminBucketsResponse;
    } else if (currentEvent === "error") {
      const detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
      throw new Error(detail || "Advanced search stream failed");
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

  if (!resultPayload) {
    throw new Error("Advanced search stream ended without a result payload");
  }
  return resultPayload;
}

export type CephAdminBucketCompareRequest = {
  target_endpoint_id: number;
  source_bucket: string;
  target_bucket: string;
  include_content?: boolean;
  include_config?: boolean;
  config_features?: CephAdminBucketCompareConfigFeature[];
  diff_sample_limit?: number;
};

export type CephAdminBucketCompareConfigFeature =
  | "versioning_status"
  | "object_lock"
  | "public_access_block"
  | "lifecycle_rules"
  | "cors_rules"
  | "bucket_policy"
  | "access_logging"
  | "tags";

export type CephAdminBucketObjectDiffEntry = {
  key: string;
  source_size?: number | null;
  target_size?: number | null;
  source_etag?: string | null;
  target_etag?: string | null;
  compare_by: "md5" | "size";
};

export type CephAdminBucketContentDiff = {
  source_count: number;
  target_count: number;
  matched_count: number;
  different_count: number;
  only_source_count: number;
  only_target_count: number;
  only_source_sample: string[];
  only_target_sample: string[];
  different_sample: CephAdminBucketObjectDiffEntry[];
};

export type CephAdminBucketConfigDiffSection = {
  key: string;
  label: string;
  source?: unknown;
  target?: unknown;
  changed: boolean;
};

export type CephAdminBucketConfigDiff = {
  changed: boolean;
  sections: CephAdminBucketConfigDiffSection[];
};

export type CephAdminBucketCompareResult = {
  source_endpoint_id: number;
  target_endpoint_id: number;
  source_bucket: string;
  target_bucket: string;
  has_differences: boolean;
  content_diff?: CephAdminBucketContentDiff | null;
  config_diff?: CephAdminBucketConfigDiff | null;
};

export async function compareCephAdminBucketPair(
  sourceEndpointId: number,
  payload: CephAdminBucketCompareRequest,
  options?: { signal?: AbortSignal }
): Promise<CephAdminBucketCompareResult> {
  const { data } = await client.post<CephAdminBucketCompareResult>(
    `/ceph-admin/endpoints/${sourceEndpointId}/buckets/compare`,
    payload,
    { signal: options?.signal }
  );
  return data;
}

export type BucketLifecycleConfig = { rules: Record<string, unknown>[] };
export type BucketCors = { rules: Record<string, unknown>[] };
export type BucketEncryptionConfiguration = { rules: Record<string, unknown>[] };
export type BucketPolicy = { policy: Record<string, unknown> | null };
export type BucketTag = { key: string; value: string };
export type BucketReplicationConfiguration = { configuration: Record<string, unknown> };

export type BucketObjectLockConfiguration = {
  enabled?: boolean | null;
  mode?: string | null;
  days?: number | null;
  years?: number | null;
};

export type BucketPublicAccessBlock = {
  block_public_acls?: boolean | null;
  ignore_public_acls?: boolean | null;
  block_public_policy?: boolean | null;
  restrict_public_buckets?: boolean | null;
};

export type BucketLifecycleRule = {
  id?: string | null;
  status?: string | null;
  prefix?: string | null;
};

export type BucketProperties = {
  versioning_status?: string | null;
  object_lock_enabled?: boolean | null;
  object_lock?: BucketObjectLockConfiguration | null;
  public_access_block?: BucketPublicAccessBlock | null;
  lifecycle_rules: BucketLifecycleRule[];
  cors_rules?: Record<string, unknown>[] | null;
};

export async function getCephAdminBucketProperties(endpointId: number, bucketName: string): Promise<BucketProperties> {
  const { data } = await client.get<BucketProperties>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/properties`
  );
  return data;
}

export async function setCephAdminBucketVersioning(endpointId: number, bucketName: string, enabled: boolean): Promise<void> {
  await client.put(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/versioning`, { enabled });
}

export async function getCephAdminBucketLifecycle(endpointId: number, bucketName: string): Promise<BucketLifecycleConfig> {
  const { data } = await client.get<BucketLifecycleConfig>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/lifecycle`
  );
  return data;
}

export async function putCephAdminBucketLifecycle(endpointId: number, bucketName: string, rules: Record<string, unknown>[]): Promise<BucketLifecycleConfig> {
  const { data } = await client.put<BucketLifecycleConfig>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/lifecycle`,
    { rules }
  );
  return data;
}

export async function deleteCephAdminBucketLifecycle(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/lifecycle`);
}

export async function getCephAdminBucketCors(endpointId: number, bucketName: string): Promise<BucketCors> {
  const { data } = await client.get<BucketCors>(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/cors`);
  return data;
}

export async function putCephAdminBucketCors(endpointId: number, bucketName: string, rules: Record<string, unknown>[]): Promise<BucketCors> {
  const { data } = await client.put<BucketCors>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/cors`,
    { rules }
  );
  return data;
}

export async function deleteCephAdminBucketCors(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/cors`);
}

export async function getCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string
): Promise<BucketEncryptionConfiguration> {
  const { data } = await client.get<BucketEncryptionConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/encryption`
  );
  return data;
}

export async function putCephAdminBucketEncryption(
  endpointId: number,
  bucketName: string,
  rules: Record<string, unknown>[]
): Promise<BucketEncryptionConfiguration> {
  const { data } = await client.put<BucketEncryptionConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/encryption`,
    { rules }
  );
  return data;
}

export async function deleteCephAdminBucketEncryption(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/encryption`);
}

export async function getCephAdminBucketPolicy(endpointId: number, bucketName: string): Promise<BucketPolicy> {
  const { data } = await client.get<BucketPolicy>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/policy`
  );
  return data;
}

export async function putCephAdminBucketPolicy(endpointId: number, bucketName: string, policy: Record<string, unknown>): Promise<BucketPolicy> {
  const { data } = await client.put<BucketPolicy>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/policy`,
    { policy }
  );
  return data;
}

export async function deleteCephAdminBucketPolicy(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/policy`);
}

export async function getCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.get<BucketNotificationConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/notifications`
  );
  return data;
}

export async function putCephAdminBucketNotifications(
  endpointId: number,
  bucketName: string,
  configuration: Record<string, unknown>
): Promise<BucketNotificationConfiguration> {
  const { data } = await client.put<BucketNotificationConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/notifications`,
    { configuration }
  );
  return data;
}

export async function deleteCephAdminBucketNotifications(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/notifications`);
}

export async function getCephAdminBucketReplication(
  endpointId: number,
  bucketName: string
): Promise<BucketReplicationConfiguration> {
  const { data } = await client.get<BucketReplicationConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/replication`
  );
  return data;
}

export async function putCephAdminBucketReplication(
  endpointId: number,
  bucketName: string,
  configuration: Record<string, unknown>
): Promise<BucketReplicationConfiguration> {
  const { data } = await client.put<BucketReplicationConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/replication`,
    { configuration }
  );
  return data;
}

export async function deleteCephAdminBucketReplication(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/replication`);
}

export async function getCephAdminBucketLogging(
  endpointId: number,
  bucketName: string
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.get<BucketLoggingConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/logging`
  );
  return data;
}

export async function putCephAdminBucketLogging(
  endpointId: number,
  bucketName: string,
  payload: BucketLoggingConfiguration
): Promise<BucketLoggingConfiguration> {
  const { data } = await client.put<BucketLoggingConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/logging`,
    payload
  );
  return data;
}

export async function deleteCephAdminBucketLogging(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/logging`);
}

export async function getCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string
): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.get<BucketWebsiteConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/website`
  );
  return data;
}

export async function putCephAdminBucketWebsite(
  endpointId: number,
  bucketName: string,
  payload: BucketWebsiteConfiguration
): Promise<BucketWebsiteConfiguration> {
  const { data } = await client.put<BucketWebsiteConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/website`,
    payload
  );
  return data;
}

export async function deleteCephAdminBucketWebsite(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/website`);
}

export async function getCephAdminBucketTags(endpointId: number, bucketName: string): Promise<{ tags: BucketTag[] }> {
  const { data } = await client.get<{ tags: BucketTag[] }>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/tags`
  );
  return data;
}

export async function putCephAdminBucketTags(endpointId: number, bucketName: string, tags: BucketTag[]): Promise<void> {
  await client.put(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/tags`, { tags });
}

export async function deleteCephAdminBucketTags(endpointId: number, bucketName: string): Promise<void> {
  await client.delete(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/tags`);
}

export type BucketAclGrantee = {
  type: string;
  id?: string | null;
  display_name?: string | null;
  uri?: string | null;
};

export type BucketAclGrant = {
  grantee: BucketAclGrantee;
  permission: string;
};

export type BucketAcl = {
  owner?: string | null;
  grants: BucketAclGrant[];
};

export async function getCephAdminBucketAcl(endpointId: number, bucketName: string): Promise<BucketAcl> {
  const { data } = await client.get<BucketAcl>(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/acl`);
  return data;
}

export async function updateCephAdminBucketAcl(endpointId: number, bucketName: string, acl: string): Promise<BucketAcl> {
  const { data } = await client.put<BucketAcl>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/acl`,
    { acl }
  );
  return data;
}

export async function getCephAdminBucketPublicAccessBlock(endpointId: number, bucketName: string): Promise<BucketPublicAccessBlock> {
  const { data } = await client.get<BucketPublicAccessBlock>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/public-access-block`
  );
  return data;
}

export async function updateCephAdminBucketPublicAccessBlock(
  endpointId: number,
  bucketName: string,
  payload: BucketPublicAccessBlock
): Promise<BucketPublicAccessBlock> {
  const { data } = await client.put<BucketPublicAccessBlock>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/public-access-block`,
    payload
  );
  return data;
}

export async function updateCephAdminBucketObjectLock(
  endpointId: number,
  bucketName: string,
  payload: BucketObjectLockConfiguration
): Promise<BucketObjectLockConfiguration> {
  const { data } = await client.put<BucketObjectLockConfiguration>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/object-lock`,
    payload
  );
  return data;
}

export async function updateCephAdminBucketQuota(
  endpointId: number,
  bucketName: string,
  payload: BucketQuotaUpdate
): Promise<void> {
  await client.put(`/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucketName)}/quota`, payload);
}

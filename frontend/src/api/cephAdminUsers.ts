/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminRgwQuotaConfig } from "./cephAdmin";
import {
  buildCephAdminEntityListingQuery,
  type CephAdminEntityListingParams,
  type CephAdminEntityListingRequestOptions,
  type CephAdminListingStreamOptions,
  type CephAdminListingStreamProgress,
} from "./cephAdminEntityListing";
import type {
  CephAdminRgwAccessKey,
  CephAdminRgwGeneratedAccessKey,
} from "./cephAdminUserKeys";
import client from "./client";
import { resolveApiBaseUrl, streamBucketsWithSse } from "./sseBucketsStream";
import type { PaginatedResponse } from "./types";

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

type CreateCephAdminUserResponse = {
  detail: CephAdminRgwUserDetail;
  generated_key?: CephAdminRgwGeneratedAccessKey | null;
};

type PaginatedCephAdminUsersResponse = PaginatedResponse<CephAdminRgwUser>;

type ListCephAdminUsersParams = CephAdminEntityListingParams;

export async function listCephAdminUsers(
  endpointId: number,
  params?: ListCephAdminUsersParams,
  options?: CephAdminEntityListingRequestOptions,
): Promise<PaginatedCephAdminUsersResponse> {
  const { data } = await client.get<PaginatedCephAdminUsersResponse>(
    `/ceph-admin/endpoints/${endpointId}/users`,
    {
      params: {
        ...params,
        include: params?.include?.join(","),
      },
      signal: options?.signal,
    },
  );
  return data;
}

export async function streamCephAdminUsers(
  endpointId: number,
  params?: ListCephAdminUsersParams,
  options?: CephAdminListingStreamOptions,
): Promise<PaginatedCephAdminUsersResponse> {
  const baseUrl = resolveApiBaseUrl();
  const query = buildCephAdminEntityListingQuery(params);
  const queryText = query.toString();
  const url = `${baseUrl}/ceph-admin/endpoints/${endpointId}/users/stream${queryText ? `?${queryText}` : ""}`;
  return streamBucketsWithSse<
    CephAdminListingStreamProgress,
    PaginatedCephAdminUsersResponse
  >({
    url,
    options,
    streamFailedLabel: "Advanced search stream failed",
    missingResultMessage:
      "Advanced search stream ended without a result payload",
  });
}

export async function createCephAdminUser(
  endpointId: number,
  payload: CreateCephAdminUserPayload,
): Promise<CreateCephAdminUserResponse> {
  const { data } = await client.post<CreateCephAdminUserResponse>(
    `/ceph-admin/endpoints/${endpointId}/users`,
    payload,
  );
  return data;
}

export async function getCephAdminUserDetail(
  endpointId: number,
  uid: string,
  tenant?: string | null,
): Promise<CephAdminRgwUserDetail> {
  const { data } = await client.get<CephAdminRgwUserDetail>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/detail`,
    { params: tenant ? { tenant } : undefined },
  );
  return data;
}

export async function updateCephAdminUserConfig(
  endpointId: number,
  uid: string,
  payload: UpdateCephAdminUserPayload,
  tenant?: string | null,
): Promise<CephAdminRgwUserDetail> {
  const { data } = await client.put<CephAdminRgwUserDetail>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}/config`,
    payload,
    { params: tenant ? { tenant } : undefined },
  );
  return data;
}

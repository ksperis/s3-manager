/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type CephAdminAdminOpsResult = {
  operation: string;
  success: boolean;
  rgw_status_code?: number | null;
  rgw_error_code?: string | null;
  message: string;
  result?: unknown;
};

const tenantParams = (tenant?: string | null) => (tenant ? { tenant } : undefined);

export async function deleteCephAdminAccount(
  endpointId: number,
  accountId: string,
  confirmation: string
): Promise<CephAdminAdminOpsResult> {
  const { data } = await client.delete<CephAdminAdminOpsResult>(
    `/ceph-admin/endpoints/${endpointId}/accounts/${encodeURIComponent(accountId)}`,
    { data: { confirmation } }
  );
  return data;
}

export async function deleteCephAdminUser(
  endpointId: number,
  uid: string,
  payload: { confirmation: string; purge_data: boolean },
  tenant?: string | null
): Promise<CephAdminAdminOpsResult> {
  const { data } = await client.delete<CephAdminAdminOpsResult>(
    `/ceph-admin/endpoints/${endpointId}/users/${encodeURIComponent(uid)}`,
    { params: tenantParams(tenant), data: payload }
  );
  return data;
}

export async function deleteCephAdminBucket(
  endpointId: number,
  bucket: string,
  payload: { confirmation: string; purge_objects: boolean; bypass_gc: boolean },
  tenant?: string | null
): Promise<CephAdminAdminOpsResult> {
  const { data } = await client.delete<CephAdminAdminOpsResult>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucket)}`,
    { params: tenantParams(tenant), data: payload }
  );
  return data;
}

export async function unlinkCephAdminBucket(
  endpointId: number,
  bucket: string,
  confirmation: string,
  tenant?: string | null
): Promise<CephAdminAdminOpsResult> {
  const { data } = await client.post<CephAdminAdminOpsResult>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucket)}/unlink`,
    { confirmation },
    { params: tenantParams(tenant) }
  );
  return data;
}

export async function linkCephAdminBucket(
  endpointId: number,
  bucket: string,
  payload: { confirmation: string; target_type: "user" | "account"; target_id: string },
  tenant?: string | null
): Promise<CephAdminAdminOpsResult> {
  const { data } = await client.put<CephAdminAdminOpsResult>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucket)}/link`,
    payload,
    { params: tenantParams(tenant) }
  );
  return data;
}

export async function checkCephAdminBucketIndex(
  endpointId: number,
  bucket: string,
  payload: { confirmation?: string; fix: boolean; check_objects: boolean },
  tenant?: string | null
): Promise<CephAdminAdminOpsResult> {
  const { data } = await client.post<CephAdminAdminOpsResult>(
    `/ceph-admin/endpoints/${endpointId}/buckets/${encodeURIComponent(bucket)}/index-check`,
    payload,
    { params: tenantParams(tenant) }
  );
  return data;
}

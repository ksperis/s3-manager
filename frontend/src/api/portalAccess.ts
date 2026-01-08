/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type PortalExternalAccessKey = {
  access_key_id: string;
  status?: string | null;
  created_at?: string | null;
  is_active: boolean;
};

export type PortalAccessGrant = {
  id: number;
  user_id: number;
  package_key: string;
  bucket: string;
  prefix?: string | null;
  materialization_status: string;
  materialization_error?: string | null;
};

export type PortalExternalAccessStatus = {
  allow_external_access: boolean;
  external_enabled: boolean;
  iam_username?: string | null;
  active_access_key_id?: string | null;
  keys: PortalExternalAccessKey[];
  grants: PortalAccessGrant[];
  allowed_packages: string[];
  fetched_at: string;
};

export type PortalExternalAccessCredentials = {
  iam_username: string;
  access_key_id: string;
  secret_access_key: string;
  created_at?: string | null;
};

export async function fetchMyExternalAccess(accountId: S3AccountSelector): Promise<PortalExternalAccessStatus> {
  const { data } = await client.get<PortalExternalAccessStatus>("/portal/access/me", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchUserExternalAccess(
  accountId: S3AccountSelector,
  userId: number
): Promise<PortalExternalAccessStatus> {
  const { data } = await client.get<PortalExternalAccessStatus>(`/portal/access/users/${userId}`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function enableMyExternalAccess(accountId: S3AccountSelector): Promise<PortalExternalAccessCredentials> {
  const { data } = await client.post<PortalExternalAccessCredentials>("/portal/access/me/enable", undefined, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function rotateMyExternalAccessKey(accountId: S3AccountSelector): Promise<PortalExternalAccessCredentials> {
  const { data } = await client.post<PortalExternalAccessCredentials>("/portal/access/me/rotate", undefined, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function revokeMyExternalAccess(accountId: S3AccountSelector): Promise<void> {
  await client.post("/portal/access/me/revoke", undefined, { params: withS3AccountParam(undefined, accountId) });
}

export async function enableUserExternalAccess(
  accountId: S3AccountSelector,
  userId: number
): Promise<PortalExternalAccessCredentials> {
  const { data } = await client.post<PortalExternalAccessCredentials>(`/portal/access/users/${userId}/enable`, undefined, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function rotateUserExternalAccessKey(
  accountId: S3AccountSelector,
  userId: number
): Promise<PortalExternalAccessCredentials> {
  const { data } = await client.post<PortalExternalAccessCredentials>(`/portal/access/users/${userId}/rotate`, undefined, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function revokeUserExternalAccess(accountId: S3AccountSelector, userId: number): Promise<void> {
  await client.post(`/portal/access/users/${userId}/revoke`, undefined, { params: withS3AccountParam(undefined, accountId) });
}

export type PortalGrantAssignRequest = {
  user_id: number;
  package_key: string;
  bucket: string;
  prefix?: string | null;
};

export async function assignAccessGrant(
  accountId: S3AccountSelector,
  payload: PortalGrantAssignRequest
): Promise<PortalAccessGrant> {
  const { data } = await client.post<PortalAccessGrant>("/portal/access/grants", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function revokeAccessGrant(accountId: S3AccountSelector, userId: number, grantId: number): Promise<void> {
  await client.delete(`/portal/access/grants/${userId}/${grantId}`, { params: withS3AccountParam(undefined, accountId) });
}

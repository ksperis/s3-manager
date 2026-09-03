/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import client from "./client";

export type PortalAccessKey = {
  access_key_id: string;
  status?: string | null;
  created_at?: string | null;
  is_active: boolean;
  is_portal?: boolean;
  deletable?: boolean;
  secret_access_key?: string | null;
  session_token?: string | null;
  expires_at?: string | null;
  target_type?: "self" | "external";
  external_email?: string | null;
  storage_space_name?: string | null;
  bucket_name?: string | null;
  permission?: "read_only" | "read_write" | null;
};

export type PortalAccessKeyCreate = {
  target_type?: "self" | "external";
  storage_space_id?: string | null;
  external_email?: string | null;
  permission?: "read_only" | "read_write" | null;
};

export type PortalIAMUser = {
  iam_user_id?: string | null;
  iam_username?: string | null;
  arn?: string | null;
  created_at?: string | null;
};

export type PortalAccessKeysState = {
  iam_user: PortalIAMUser;
  s3_endpoint?: string | null;
  force_path_style?: boolean;
  access_keys: PortalAccessKey[];
  can_manage_access_keys: boolean;
  max_access_keys: number;
};

export async function fetchPortalAccessKeysState(
  accountId: S3AccountSelector,
): Promise<PortalAccessKeysState> {
  const { data } = await client.get<PortalAccessKeysState>("/portal/access-keys", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function createPortalAccessKey(
  accountId: S3AccountSelector,
  payload?: PortalAccessKeyCreate,
): Promise<PortalAccessKey> {
  const { data } = await client.post<PortalAccessKey>(
    "/portal/access-keys",
    payload,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function updatePortalAccessKeyStatus(
  accountId: S3AccountSelector,
  accessKeyId: string,
  active: boolean,
): Promise<PortalAccessKey> {
  const { data } = await client.put<PortalAccessKey>(
    `/portal/access-keys/${encodeURIComponent(accessKeyId)}/status`,
    { active },
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function deletePortalAccessKey(
  accountId: S3AccountSelector,
  accessKeyId: string,
): Promise<void> {
  await client.delete(`/portal/access-keys/${encodeURIComponent(accessKeyId)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

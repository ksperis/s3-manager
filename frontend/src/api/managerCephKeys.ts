/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type ManagerCephAccessKey = {
  access_key_id: string;
  status?: string | null;
  created_at?: string | null;
  is_ui_managed: boolean;
  is_active?: boolean | null;
};

export type ManagerCephGeneratedAccessKey = {
  access_key_id: string;
  secret_access_key: string;
  created_at?: string | null;
};

export async function listManagerCephAccessKeys(accountId?: S3AccountSelector): Promise<ManagerCephAccessKey[]> {
  const { data } = await client.get<ManagerCephAccessKey[]>("/manager/ceph/keys", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function createManagerCephAccessKey(accountId?: S3AccountSelector): Promise<ManagerCephGeneratedAccessKey> {
  const { data } = await client.post<ManagerCephGeneratedAccessKey>(
    "/manager/ceph/keys",
    {},
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updateManagerCephAccessKeyStatus(
  accountId: S3AccountSelector,
  accessKeyId: string,
  active: boolean
): Promise<ManagerCephAccessKey> {
  const { data } = await client.put<ManagerCephAccessKey>(
    `/manager/ceph/keys/${encodeURIComponent(accessKeyId)}/status`,
    { active },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteManagerCephAccessKey(accountId: S3AccountSelector, accessKeyId: string): Promise<void> {
  await client.delete(`/manager/ceph/keys/${encodeURIComponent(accessKeyId)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

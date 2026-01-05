/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { IamPolicy, InlinePolicy } from "./managerIamPolicies";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type AccessKey = {
  access_key_id: string;
  status?: string;
  created_at?: string;
  secret_access_key?: string;
};

export type IAMUser = {
  name: string;
  arn?: string;
  groups?: string[];
  policies?: string[];
  inline_policies?: string[];
  has_keys?: boolean;
};
export type IAMUserWithKey = IAMUser & { access_key?: AccessKey };

export async function listIamUsers(accountId?: S3AccountSelector): Promise<IAMUser[]> {
  const { data } = await client.get<IAMUser[]>("/manager/iam/users", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function createIamUser(
  accountId?: S3AccountSelector,
  name: string,
  createKey = false,
  groups?: string[],
  policies?: string[],
  inlinePolicies?: InlinePolicy[]
): Promise<IAMUserWithKey> {
  const { data } = await client.post<IAMUserWithKey>(
    "/manager/iam/users",
    { name, create_key: createKey, groups, policies, inline_policies: inlinePolicies },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteIamUser(accountId: S3AccountSelector, name: string): Promise<void> {
  await client.delete(`/manager/iam/users/${encodeURIComponent(name)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function listIamAccessKeys(accountId: S3AccountSelector, userName: string): Promise<AccessKey[]> {
  const { data } = await client.get<AccessKey[]>(
    `/manager/iam/users/${encodeURIComponent(userName)}/keys`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function createIamAccessKey(accountId: S3AccountSelector, userName: string): Promise<AccessKey> {
  const { data } = await client.post<AccessKey>(
    `/manager/iam/users/${encodeURIComponent(userName)}/keys`,
    {},
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteIamAccessKey(
  accountId: S3AccountSelector,
  userName: string,
  accessKeyId: string
): Promise<void> {
  await client.delete(
    `/manager/iam/users/${encodeURIComponent(userName)}/keys/${encodeURIComponent(accessKeyId)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function updateIamAccessKeyStatus(
  accountId: S3AccountSelector,
  userName: string,
  accessKeyId: string,
  active: boolean
): Promise<AccessKey> {
  const { data } = await client.put<AccessKey>(
    `/manager/iam/users/${encodeURIComponent(userName)}/keys/${encodeURIComponent(accessKeyId)}/status`,
    { active },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function listUserPolicies(accountId: S3AccountSelector, userName: string): Promise<IamPolicy[]> {
  const { data } = await client.get<IamPolicy[]>(
    `/manager/iam/users/${encodeURIComponent(userName)}/policies`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function attachUserPolicy(
  accountId: S3AccountSelector,
  userName: string,
  policy: IamPolicy
): Promise<IamPolicy> {
  const { data } = await client.post<IamPolicy>(
    `/manager/iam/users/${encodeURIComponent(userName)}/policies`,
    policy,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function detachUserPolicy(
  accountId: S3AccountSelector,
  userName: string,
  policyArn: string
): Promise<void> {
  await client.delete(
    `/manager/iam/users/${encodeURIComponent(userName)}/policies/${encodeURIComponent(policyArn)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function listUserInlinePolicies(
  accountId: S3AccountSelector,
  userName: string
): Promise<InlinePolicy[]> {
  const { data } = await client.get<InlinePolicy[]>(
    `/manager/iam/users/${encodeURIComponent(userName)}/inline-policies`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function putUserInlinePolicy(
  accountId: S3AccountSelector,
  userName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  const { data } = await client.put<InlinePolicy>(
    `/manager/iam/users/${encodeURIComponent(userName)}/inline-policies/${encodeURIComponent(policyName)}`,
    { name: policyName, document },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteUserInlinePolicy(
  accountId: S3AccountSelector,
  userName: string,
  policyName: string
): Promise<void> {
  await client.delete(
    `/manager/iam/users/${encodeURIComponent(userName)}/inline-policies/${encodeURIComponent(policyName)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import { IamPolicy, InlinePolicy } from "./managerIamPolicies";
import { IAMUser } from "./managerIamUsers";

export type IAMGroup = { name: string; arn?: string; policies?: string[] };

export async function listIamGroups(accountId?: S3AccountSelector): Promise<IAMGroup[]> {
  const { data } = await client.get<IAMGroup[]>("/manager/iam/groups", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function createIamGroup(
  accountId: S3AccountSelector,
  name: string,
  inlinePolicies?: InlinePolicy[]
): Promise<IAMGroup> {
  const { data } = await client.post<IAMGroup>(
    "/manager/iam/groups",
    { name, inline_policies: inlinePolicies },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteIamGroup(accountId: S3AccountSelector, name: string): Promise<void> {
  await client.delete(`/manager/iam/groups/${encodeURIComponent(name)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function listIamGroupUsers(accountId: S3AccountSelector, groupName: string): Promise<IAMUser[]> {
  const { data } = await client.get<IAMUser[]>(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/users`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function addIamGroupUser(
  accountId: S3AccountSelector,
  groupName: string,
  userName: string
): Promise<IAMUser> {
  const { data } = await client.post<IAMUser>(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/users`,
    { name: userName },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function removeIamGroupUser(
  accountId: S3AccountSelector,
  groupName: string,
  userName: string
): Promise<void> {
  await client.delete(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/users/${encodeURIComponent(userName)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function listGroupPolicies(accountId: S3AccountSelector, groupName: string): Promise<IamPolicy[]> {
  const { data } = await client.get<IamPolicy[]>(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/policies`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function attachGroupPolicy(
  accountId: S3AccountSelector,
  groupName: string,
  policy: IamPolicy
): Promise<IamPolicy> {
  const { data } = await client.post<IamPolicy>(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/policies`,
    policy,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function detachGroupPolicy(
  accountId: S3AccountSelector,
  groupName: string,
  policyArn: string
): Promise<void> {
  await client.delete(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/policies/${encodeURIComponent(policyArn)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function listGroupInlinePolicies(
  accountId: S3AccountSelector,
  groupName: string
): Promise<InlinePolicy[]> {
  const { data } = await client.get<InlinePolicy[]>(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/inline-policies`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function putGroupInlinePolicy(
  accountId: S3AccountSelector,
  groupName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  const { data } = await client.put<InlinePolicy>(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/inline-policies/${encodeURIComponent(policyName)}`,
    { name: policyName, document },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteGroupInlinePolicy(
  accountId: S3AccountSelector,
  groupName: string,
  policyName: string
): Promise<void> {
  await client.delete(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/inline-policies/${encodeURIComponent(policyName)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
}

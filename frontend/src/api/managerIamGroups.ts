/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import { IAMUser } from "./managerIamUsers";
import { IamPolicy, InlinePolicy } from "./managerIamPolicies";
import {
  attachEntityPolicy,
  createIamEntity,
  deleteEntityInlinePolicy,
  deleteIamEntity,
  detachEntityPolicy,
  listEntityInlinePolicies,
  listEntityPolicies,
  listIamEntities,
  putEntityInlinePolicy,
} from "./managerIamEntityClient";

export type IAMGroup = { name: string; arn?: string; policies?: string[] };

export async function listIamGroups(accountId?: S3AccountSelector): Promise<IAMGroup[]> {
  return listIamEntities<IAMGroup>("groups", accountId);
}

export async function createIamGroup(
  accountId: S3AccountSelector,
  name: string,
  inlinePolicies?: InlinePolicy[]
): Promise<IAMGroup> {
  return createIamEntity<IAMGroup>("groups", accountId, { name, inline_policies: inlinePolicies });
}

export async function deleteIamGroup(accountId: S3AccountSelector, name: string): Promise<void> {
  await deleteIamEntity("groups", accountId, name);
}

export async function listIamGroupUsers(accountId: S3AccountSelector, groupName: string): Promise<IAMUser[]> {
  const { data } = await client.get<IAMUser[]>(`/manager/iam/groups/${encodeURIComponent(groupName)}/users`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function addIamGroupUser(accountId: S3AccountSelector, groupName: string, userName: string): Promise<IAMUser> {
  const { data } = await client.post<IAMUser>(
    `/manager/iam/groups/${encodeURIComponent(groupName)}/users`,
    { name: userName },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function removeIamGroupUser(accountId: S3AccountSelector, groupName: string, userName: string): Promise<void> {
  await client.delete(`/manager/iam/groups/${encodeURIComponent(groupName)}/users/${encodeURIComponent(userName)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function listGroupPolicies(accountId: S3AccountSelector, groupName: string): Promise<IamPolicy[]> {
  return listEntityPolicies("groups", accountId, groupName);
}

export async function attachGroupPolicy(
  accountId: S3AccountSelector,
  groupName: string,
  policy: IamPolicy
): Promise<IamPolicy> {
  return attachEntityPolicy("groups", accountId, groupName, policy);
}

export async function detachGroupPolicy(accountId: S3AccountSelector, groupName: string, policyArn: string): Promise<void> {
  await detachEntityPolicy("groups", accountId, groupName, policyArn);
}

export async function listGroupInlinePolicies(accountId: S3AccountSelector, groupName: string): Promise<InlinePolicy[]> {
  return listEntityInlinePolicies("groups", accountId, groupName);
}

export async function putGroupInlinePolicy(
  accountId: S3AccountSelector,
  groupName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  return putEntityInlinePolicy("groups", accountId, groupName, policyName, document);
}

export async function deleteGroupInlinePolicy(accountId: S3AccountSelector, groupName: string, policyName: string): Promise<void> {
  await deleteEntityInlinePolicy("groups", accountId, groupName, policyName);
}

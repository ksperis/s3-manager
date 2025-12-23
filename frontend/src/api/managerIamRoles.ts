/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import { IamPolicy, InlinePolicy } from "./managerIamPolicies";

export type IAMRole = {
  name: string;
  arn?: string;
  path?: string;
  policies?: string[];
  assume_role_policy_document?: Record<string, unknown> | string;
};

export type CreateRolePayload = {
  name: string;
  path?: string;
  assume_role_policy_document?: Record<string, unknown> | string;
  inline_policies?: InlinePolicy[];
};

export type UpdateRolePayload = {
  path?: string;
  assume_role_policy_document?: Record<string, unknown> | string;
};

export async function listIamRoles(accountId?: S3AccountSelector): Promise<IAMRole[]> {
  const { data } = await client.get<IAMRole[]>("/manager/iam/roles", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function getIamRole(accountId: S3AccountSelector, roleName: string): Promise<IAMRole> {
  const { data } = await client.get<IAMRole>(
    `/manager/iam/roles/${encodeURIComponent(roleName)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function createIamRole(accountId: S3AccountSelector, payload: CreateRolePayload): Promise<IAMRole> {
  const { data } = await client.post<IAMRole>(
    "/manager/iam/roles",
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function updateIamRole(accountId: S3AccountSelector, roleName: string, payload: UpdateRolePayload): Promise<IAMRole> {
  const { data } = await client.put<IAMRole>(
    `/manager/iam/roles/${encodeURIComponent(roleName)}`,
    payload,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteIamRole(accountId: S3AccountSelector, name: string): Promise<void> {
  await client.delete(`/manager/iam/roles/${encodeURIComponent(name)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function listRolePolicies(accountId: S3AccountSelector, roleName: string): Promise<IamPolicy[]> {
  const { data } = await client.get<IamPolicy[]>(
    `/manager/iam/roles/${encodeURIComponent(roleName)}/policies`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function attachRolePolicy(
  accountId: S3AccountSelector,
  roleName: string,
  policy: IamPolicy
): Promise<IamPolicy> {
  const { data } = await client.post<IamPolicy>(
    `/manager/iam/roles/${encodeURIComponent(roleName)}/policies`,
    policy,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function detachRolePolicy(
  accountId: S3AccountSelector,
  roleName: string,
  policyArn: string
): Promise<void> {
  await client.delete(
    `/manager/iam/roles/${encodeURIComponent(roleName)}/policies/${encodeURIComponent(policyArn)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
}

export async function listRoleInlinePolicies(
  accountId: S3AccountSelector,
  roleName: string
): Promise<InlinePolicy[]> {
  const { data } = await client.get<InlinePolicy[]>(
    `/manager/iam/roles/${encodeURIComponent(roleName)}/inline-policies`,
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function putRoleInlinePolicy(
  accountId: S3AccountSelector,
  roleName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  const { data } = await client.put<InlinePolicy>(
    `/manager/iam/roles/${encodeURIComponent(roleName)}/inline-policies/${encodeURIComponent(policyName)}`,
    { name: policyName, document },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function deleteRoleInlinePolicy(
  accountId: S3AccountSelector,
  roleName: string,
  policyName: string
): Promise<void> {
  await client.delete(
    `/manager/iam/roles/${encodeURIComponent(roleName)}/inline-policies/${encodeURIComponent(policyName)}`,
    { params: withS3AccountParam(undefined, accountId) }
  );
}

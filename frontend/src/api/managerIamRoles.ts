/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
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
  return listIamEntities<IAMRole>("roles", accountId);
}

export async function getIamRole(accountId: S3AccountSelector, roleName: string): Promise<IAMRole> {
  const { data } = await client.get<IAMRole>(`/manager/iam/roles/${encodeURIComponent(roleName)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function createIamRole(accountId: S3AccountSelector, payload: CreateRolePayload): Promise<IAMRole> {
  return createIamEntity<IAMRole>("roles", accountId, payload as Record<string, unknown>);
}

export async function updateIamRole(accountId: S3AccountSelector, roleName: string, payload: UpdateRolePayload): Promise<IAMRole> {
  const { data } = await client.put<IAMRole>(`/manager/iam/roles/${encodeURIComponent(roleName)}`, payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function deleteIamRole(accountId: S3AccountSelector, name: string): Promise<void> {
  await deleteIamEntity("roles", accountId, name);
}

export async function listRolePolicies(accountId: S3AccountSelector, roleName: string): Promise<IamPolicy[]> {
  return listEntityPolicies("roles", accountId, roleName);
}

export async function attachRolePolicy(accountId: S3AccountSelector, roleName: string, policy: IamPolicy): Promise<IamPolicy> {
  return attachEntityPolicy("roles", accountId, roleName, policy);
}

export async function detachRolePolicy(accountId: S3AccountSelector, roleName: string, policyArn: string): Promise<void> {
  await detachEntityPolicy("roles", accountId, roleName, policyArn);
}

export async function listRoleInlinePolicies(accountId: S3AccountSelector, roleName: string): Promise<InlinePolicy[]> {
  return listEntityInlinePolicies("roles", accountId, roleName);
}

export async function putRoleInlinePolicy(
  accountId: S3AccountSelector,
  roleName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  return putEntityInlinePolicy("roles", accountId, roleName, policyName, document);
}

export async function deleteRoleInlinePolicy(accountId: S3AccountSelector, roleName: string, policyName: string): Promise<void> {
  await deleteEntityInlinePolicy("roles", accountId, roleName, policyName);
}

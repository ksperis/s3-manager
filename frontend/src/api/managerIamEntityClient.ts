/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import { IamPolicy, InlinePolicy } from "./managerIamPolicies";

export type IamEntitySegment = "users" | "groups" | "roles";

function segmentBasePath(segment: IamEntitySegment): string {
  return `/manager/iam/${segment}`;
}

function entityPath(segment: IamEntitySegment, entityName: string): string {
  return `${segmentBasePath(segment)}/${encodeURIComponent(entityName)}`;
}

function withAccount(accountId?: S3AccountSelector) {
  return { params: withS3AccountParam(undefined, accountId) };
}

export async function listIamEntities<T>(segment: IamEntitySegment, accountId?: S3AccountSelector): Promise<T[]> {
  const { data } = await client.get<T[]>(segmentBasePath(segment), withAccount(accountId));
  return data;
}

export async function createIamEntity<T>(
  segment: IamEntitySegment,
  accountId: S3AccountSelector | undefined,
  payload: Record<string, unknown>
): Promise<T> {
  const { data } = await client.post<T>(segmentBasePath(segment), payload, withAccount(accountId));
  return data;
}

export async function deleteIamEntity(segment: IamEntitySegment, accountId: S3AccountSelector, entityName: string): Promise<void> {
  await client.delete(entityPath(segment, entityName), withAccount(accountId));
}

export async function listEntityPolicies(
  segment: IamEntitySegment,
  accountId: S3AccountSelector,
  entityName: string
): Promise<IamPolicy[]> {
  const { data } = await client.get<IamPolicy[]>(`${entityPath(segment, entityName)}/policies`, withAccount(accountId));
  return data;
}

export async function attachEntityPolicy(
  segment: IamEntitySegment,
  accountId: S3AccountSelector,
  entityName: string,
  policy: IamPolicy
): Promise<IamPolicy> {
  const { data } = await client.post<IamPolicy>(`${entityPath(segment, entityName)}/policies`, policy, withAccount(accountId));
  return data;
}

export async function detachEntityPolicy(
  segment: IamEntitySegment,
  accountId: S3AccountSelector,
  entityName: string,
  policyArn: string
): Promise<void> {
  await client.delete(`${entityPath(segment, entityName)}/policies/${encodeURIComponent(policyArn)}`, withAccount(accountId));
}

export async function listEntityInlinePolicies(
  segment: IamEntitySegment,
  accountId: S3AccountSelector,
  entityName: string
): Promise<InlinePolicy[]> {
  const { data } = await client.get<InlinePolicy[]>(`${entityPath(segment, entityName)}/inline-policies`, withAccount(accountId));
  return data;
}

export async function putEntityInlinePolicy(
  segment: IamEntitySegment,
  accountId: S3AccountSelector,
  entityName: string,
  policyName: string,
  document: Record<string, unknown>
): Promise<InlinePolicy> {
  const { data } = await client.put<InlinePolicy>(
    `${entityPath(segment, entityName)}/inline-policies/${encodeURIComponent(policyName)}`,
    { name: policyName, document },
    withAccount(accountId)
  );
  return data;
}

export async function deleteEntityInlinePolicy(
  segment: IamEntitySegment,
  accountId: S3AccountSelector,
  entityName: string,
  policyName: string
): Promise<void> {
  await client.delete(`${entityPath(segment, entityName)}/inline-policies/${encodeURIComponent(policyName)}`, withAccount(accountId));
}

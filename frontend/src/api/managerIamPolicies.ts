/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type IamPolicy = {
  name: string;
  arn: string;
  path?: string;
  default_version_id?: string;
  document?: Record<string, unknown>;
};

export type InlinePolicy = {
  name: string;
  document: Record<string, unknown>;
};

export type InlinePolicyInventoryItem = {
  entity_type: "user" | "group" | "role";
  entity_name: string;
  policies: InlinePolicy[];
  error?: string | null;
};

export async function listIamPolicies(accountId?: S3AccountSelector): Promise<IamPolicy[]> {
  const { data } = await client.get<IamPolicy[]>("/manager/iam/policies", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function listIamInlinePolicyInventory(accountId?: S3AccountSelector): Promise<InlinePolicyInventoryItem[]> {
  const { data } = await client.get<InlinePolicyInventoryItem[]>("/manager/iam/inline-policies", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function createIamPolicy(
  accountId: S3AccountSelector,
  name: string,
  document: Record<string, unknown>
): Promise<IamPolicy> {
  const { data } = await client.post<IamPolicy>(
    "/manager/iam/policies",
    { name, document },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

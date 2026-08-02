/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";
import type { S3Connection } from "./connections";

export type ManagedInlinePolicy = {
  name: string;
  document: Record<string, unknown>;
};

type ManagedPrivateAccessBasePayload = {
  connection_name: string;
  access_browser: boolean;
  access_manager: boolean;
};

type ManagedIAMPrivateAccessPayload = ManagedPrivateAccessBasePayload & {
  groups: string[];
  managed_policies: string[];
  inline_policies: ManagedInlinePolicy[];
};

type ManagedPrivateAccessResult = {
  provisioning_id: number;
  status: "active" | "cleanup_pending";
  connection: S3Connection;
};

export async function createManagedIAMPrivateAccess(
  accountId: S3AccountSelector,
  payload: ManagedIAMPrivateAccessPayload
): Promise<ManagedPrivateAccessResult> {
  const { data } = await client.post<ManagedPrivateAccessResult>("/manager/private-access/iam", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function createManagedRGWUserPrivateAccess(
  accountId: S3AccountSelector,
  payload: ManagedPrivateAccessBasePayload
): Promise<ManagedPrivateAccessResult> {
  const { data } = await client.post<ManagedPrivateAccessResult>("/manager/private-access/rgw-user", payload, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function retryManagedPrivateAccessCleanup(connectionId: number): Promise<void> {
  await client.post(`/manager/private-access/${connectionId}/retry-cleanup`);
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { S3AccountSelector, withS3AccountParam } from "./accountParams";
import client from "./client";

export type ManagerActivityEntry = {
  id: number;
  created_at: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  account_id?: number | null;
  account_name?: string | null;
  status: string;
  user_email: string;
};

export async function listManagerActivity(
  accountId: S3AccountSelector,
  options?: { limit?: number }
): Promise<ManagerActivityEntry[]> {
  const { data } = await client.get<ManagerActivityEntry[]>("/manager/activity", {
    params: withS3AccountParam({ limit: options?.limit ?? 5 }, accountId),
  });
  return data;
}

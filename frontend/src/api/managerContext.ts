/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type ManagerAccessMode = "admin" | "portal" | "session" | "s3_user" | "connection";

export type ManagerContext = {
  access_mode: ManagerAccessMode;
  iam_identity?: string | null;
  can_switch_access?: boolean;
  manager_stats_enabled: boolean;
  manager_browser_enabled?: boolean;
};

export async function fetchManagerContext(accountId?: S3AccountSelector): Promise<ManagerContext> {
  const { data } = await client.get<ManagerContext>("/manager/context", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

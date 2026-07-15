/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type ManagerAccessMode = "admin" | "session" | "s3_user" | "connection";

export type ManagerContext = {
  access_mode: ManagerAccessMode;
  iam_identity?: string | null;
  manager_stats_enabled: boolean;
  manager_stats_message?: string | null;
  manager_browser_enabled?: boolean;
  manager_bucket_quota_enabled?: boolean;
  manager_ceph_keys_enabled?: boolean;
  quota_max_size_gb?: number | null;
  quota_max_objects?: number | null;
  max_buckets?: number | null;
  max_users?: number | null;
  max_roles?: number | null;
  max_groups?: number | null;
};

export async function fetchManagerContext(
  accountId?: S3AccountSelector,
  options: { includeLimits?: boolean } = {}
): Promise<ManagerContext> {
  const { data } = await client.get<ManagerContext>("/manager/context", {
    params: withS3AccountParam(
      options.includeLimits ? { include_limits: true } : undefined,
      accountId
    ),
  });
  return data;
}

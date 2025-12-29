/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type PortalSettings = {
  allow_portal_key: boolean;
  allow_portal_user_bucket_create: boolean;
  iam_group_manager_policy: PortalIAMPolicySettings;
  iam_group_user_policy: PortalIAMPolicySettings;
  bucket_access_policy: PortalIAMPolicySettings;
  bucket_defaults: PortalBucketDefaults;
};

export type PortalIAMPolicySettings = {
  actions: string[];
  advanced_policy?: Record<string, unknown> | null;
};

export type PortalBucketDefaults = {
  versioning: boolean;
  enable_cors: boolean;
  enable_lifecycle: boolean;
  cors_allowed_origins: string[];
};

export type ManagerSettings = {
  allow_manager_user_usage_stats: boolean;
};

export type BrowserSettings = {
  direct_upload_parallelism: number;
  proxy_upload_parallelism: number;
  direct_download_parallelism: number;
  proxy_download_parallelism: number;
  other_operations_parallelism: number;
};

export type AppSettings = {
  portal: PortalSettings;
  manager: ManagerSettings;
  browser: BrowserSettings;
};

export async function fetchAppSettings(): Promise<AppSettings> {
  const { data } = await client.get<AppSettings>("/admin/settings");
  return data;
}

export async function updateAppSettings(payload: AppSettings): Promise<AppSettings> {
  const { data } = await client.put<AppSettings>("/admin/settings", payload);
  return data;
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type PortalSettings = {
  allow_portal_key: boolean;
  allow_portal_user_bucket_create: boolean;
};

export type ManagerSettings = {
  allow_manager_user_usage_stats: boolean;
};

export type AppSettings = {
  portal: PortalSettings;
  manager: ManagerSettings;
};

export async function fetchAppSettings(): Promise<AppSettings> {
  const { data } = await client.get<AppSettings>("/admin/settings");
  return data;
}

export async function updateAppSettings(payload: AppSettings): Promise<AppSettings> {
  const { data } = await client.put<AppSettings>("/admin/settings", payload);
  return data;
}

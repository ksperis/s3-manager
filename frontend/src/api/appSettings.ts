/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type GeneralSettings = {
  manager_enabled: boolean;
  browser_enabled: boolean;
  portal_enabled: boolean;
  allow_login_access_keys: boolean;
  allow_login_endpoint_list: boolean;
  allow_login_custom_endpoint: boolean;
};

export type ManagerSettings = {
  allow_manager_user_usage_stats: boolean;
};

export type BrowserSettings = {
  allow_proxy_transfers: boolean;
  direct_upload_parallelism: number;
  proxy_upload_parallelism: number;
  direct_download_parallelism: number;
  proxy_download_parallelism: number;
  other_operations_parallelism: number;
};

export type AppSettings = {
  general: GeneralSettings;
  manager: ManagerSettings;
  browser: BrowserSettings;
};

export type PublicStorageEndpoint = {
  id: number;
  name: string;
  endpoint_url: string;
  is_default: boolean;
};

export type LoginSettings = {
  allow_login_access_keys: boolean;
  allow_login_endpoint_list: boolean;
  allow_login_custom_endpoint: boolean;
  default_endpoint_url?: string | null;
  endpoints: PublicStorageEndpoint[];
};

export async function fetchAppSettings(): Promise<AppSettings> {
  const { data } = await client.get<AppSettings>("/admin/settings");
  return data;
}

export async function fetchGeneralSettings(): Promise<GeneralSettings> {
  const { data } = await client.get<GeneralSettings>("/settings/general");
  return data;
}

export async function fetchLoginSettings(): Promise<LoginSettings> {
  const { data } = await client.get<LoginSettings>("/settings/login");
  return data;
}

export async function updateAppSettings(payload: AppSettings): Promise<AppSettings> {
  const { data } = await client.put<AppSettings>("/admin/settings", payload);
  return data;
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type PortalSettings = {
  allow_portal_key: boolean;
  allow_portal_user_bucket_create: boolean;
  allow_portal_user_access_key_create: boolean;
  iam_group_manager_policy: PortalIAMPolicySettings;
  iam_group_user_policy: PortalIAMPolicySettings;
  bucket_access_policy: PortalIAMPolicySettings;
  bucket_defaults: PortalBucketDefaults;
  override_policy: PortalSettingsOverridePolicy;
};

export type GeneralSettings = {
  manager_enabled: boolean;
  ceph_admin_enabled: boolean;
  browser_enabled: boolean;
  browser_root_enabled: boolean;
  browser_manager_enabled: boolean;
  browser_portal_enabled: boolean;
  browser_ceph_admin_enabled: boolean;
  allow_portal_manager_workspace: boolean;
  portal_enabled: boolean;
  billing_enabled: boolean;
  endpoint_status_enabled: boolean;
  allow_login_access_keys: boolean;
  allow_login_endpoint_list: boolean;
  allow_login_custom_endpoint: boolean;
  allow_user_private_connections: boolean;
};

export type GeneralFeatureLock = {
  forced: boolean;
  value?: boolean | null;
  source?: string | null;
};

export type GeneralFeatureLocks = {
  manager_enabled: GeneralFeatureLock;
  ceph_admin_enabled: GeneralFeatureLock;
  browser_enabled: GeneralFeatureLock;
  portal_enabled: GeneralFeatureLock;
  billing_enabled: GeneralFeatureLock;
  endpoint_status_enabled: GeneralFeatureLock;
};

export type PortalIAMPolicySettings = {
  actions: string[];
  advanced_policy?: Record<string, unknown> | null;
};

export type PortalIAMPolicyOverridePolicy = {
  actions: boolean;
  advanced_policy: boolean;
};

export type PortalBucketDefaultsOverridePolicy = {
  versioning: boolean;
  enable_cors: boolean;
  enable_lifecycle: boolean;
  cors_allowed_origins: boolean;
};

export type PortalSettingsOverridePolicy = {
  allow_portal_key: boolean;
  allow_portal_user_bucket_create: boolean;
  allow_portal_user_access_key_create: boolean;
  iam_group_manager_policy: PortalIAMPolicyOverridePolicy;
  iam_group_user_policy: PortalIAMPolicyOverridePolicy;
  bucket_access_policy: PortalIAMPolicyOverridePolicy;
  bucket_defaults: PortalBucketDefaultsOverridePolicy;
};

export type PortalBucketDefaults = {
  versioning: boolean;
  enable_cors: boolean;
  enable_lifecycle: boolean;
  cors_allowed_origins: string[];
};

export type PortalIAMPolicyOverride = {
  actions?: string[] | null;
  advanced_policy?: Record<string, unknown> | null;
};

export type PortalBucketDefaultsOverride = {
  versioning?: boolean | null;
  enable_cors?: boolean | null;
  enable_lifecycle?: boolean | null;
  cors_allowed_origins?: string[] | null;
};

export type PortalSettingsOverride = {
  allow_portal_key?: boolean | null;
  allow_portal_user_bucket_create?: boolean | null;
  allow_portal_user_access_key_create?: boolean | null;
  iam_group_manager_policy?: PortalIAMPolicyOverride | null;
  iam_group_user_policy?: PortalIAMPolicyOverride | null;
  bucket_access_policy?: PortalIAMPolicyOverride | null;
  bucket_defaults?: PortalBucketDefaultsOverride | null;
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
  streaming_zip_threshold_mb: number;
};

export type OnboardingSettings = {
  dismissed: boolean;
};

export type AppSettings = {
  general: GeneralSettings;
  portal: PortalSettings;
  manager: ManagerSettings;
  browser: BrowserSettings;
  onboarding: OnboardingSettings;
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
  seed_login_prefill?: boolean;
  seed_login_email?: string | null;
  seed_login_password?: string | null;
};

export async function fetchAppSettings(): Promise<AppSettings> {
  const { data } = await client.get<AppSettings>("/admin/settings");
  return data;
}

export async function fetchDefaultAppSettings(): Promise<AppSettings> {
  const { data } = await client.get<AppSettings>("/admin/settings/defaults");
  return data;
}

export async function fetchGeneralFeatureLocks(): Promise<GeneralFeatureLocks> {
  const { data } = await client.get<GeneralFeatureLocks>("/admin/settings/general-feature-locks");
  return data;
}

export async function fetchGeneralSettings(): Promise<GeneralSettings> {
  const { data } = await client.get<GeneralSettings>("/settings/general");
  return data;
}

export async function fetchLoginSettings(): Promise<LoginSettings> {
  const { data } = await client.get("/settings/login");
  const normalized = (data && typeof data === "object" ? data : {}) as Partial<LoginSettings>;
  return {
    allow_login_access_keys: Boolean(normalized.allow_login_access_keys ?? false),
    allow_login_endpoint_list: Boolean(normalized.allow_login_endpoint_list ?? false),
    allow_login_custom_endpoint: Boolean(normalized.allow_login_custom_endpoint ?? false),
    default_endpoint_url: normalized.default_endpoint_url ?? null,
    endpoints: Array.isArray(normalized.endpoints) ? normalized.endpoints : [],
    seed_login_prefill: Boolean(normalized.seed_login_prefill ?? false),
    seed_login_email: normalized.seed_login_email ?? null,
    seed_login_password: normalized.seed_login_password ?? null,
  };
}

export async function updateAppSettings(payload: AppSettings): Promise<AppSettings> {
  const { data } = await client.put<AppSettings>("/admin/settings", payload);
  return data;
}

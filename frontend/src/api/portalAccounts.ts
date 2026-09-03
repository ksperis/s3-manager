/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalAccountRole } from "./accountAccess";
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";
import type { PortalSettings, PortalSettingsOverride } from "./appSettings";
import client, { timeoutForRequestProfile } from "./client";

export type PortalAccount = {
  id: number;
  name: string;
  rgw_account_id: string;
  portal_role: PortalAccountRole;
  storage_endpoint_name: string;
  storage_endpoint_url: string;
  storage_endpoint_is_default: boolean;
  storage_endpoint_capabilities: Record<string, boolean>;
};

export type PortalState = {
  portal_role?: PortalAccountRole | null;
  can_manage_buckets?: boolean;
  can_create_private_storage_spaces?: boolean;
  can_create_team_storage_spaces?: boolean;
  can_manage_portal_users?: boolean;
  allow_named_bucket_create?: boolean;
  server_access_logging_enabled?: boolean;
  storage_space_version_cleanup_enabled?: boolean;
};

export type PortalAccountSettings = {
  effective: PortalSettings;
  admin_override: PortalSettingsOverride;
  delegated_to_portal_managers: boolean;
};

export type PortalProjectSettings = {
  effective: PortalSettings;
  project_override: PortalSettingsOverride;
  delegated_to_portal_managers: boolean;
  can_update: boolean;
};

export async function listPortalAccounts(options?: {
  signal?: AbortSignal;
}): Promise<PortalAccount[]> {
  const { data } = await client.get<PortalAccount[]>("/portal/accounts", {
    signal: options?.signal,
    timeout: timeoutForRequestProfile("interactive"),
  });
  return data;
}

export async function fetchPortalState(
  accountId: S3AccountSelector,
): Promise<PortalState> {
  const { data } = await client.get<PortalState>("/portal/state", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function fetchPortalProjectSettings(
  accountId: S3AccountSelector,
): Promise<PortalProjectSettings> {
  const { data } = await client.get<PortalProjectSettings>("/portal/settings", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function updatePortalProjectSettings(
  accountId: S3AccountSelector,
  payload: PortalSettingsOverride,
): Promise<PortalProjectSettings> {
  const { data } = await client.put<PortalProjectSettings>(
    "/portal/settings",
    payload,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

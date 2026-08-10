/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import type {
  EffectiveUserAccess,
  ManagerToolAccess,
  UiPreferences,
  UiRole,
  UserAvatarDescriptor,
} from "./users";
import type { AccountAccessRole } from "./accountRoles";

type LoginResponse = {
  access_token: string;
  token_type: string;
  user: {
    id: number;
    email: string;
    full_name?: string | null;
    display_name?: string | null;
    picture_url?: string | null;
    avatar?: UserAvatarDescriptor | null;
    role: UiRole;
    is_admin?: boolean;
    is_root?: boolean;
    can_access_ceph_admin?: boolean;
    can_access_storage_ops?: boolean;
    can_create_manual_private_connections?: boolean;
    can_provision_managed_private_connections?: boolean;
    manager_tool_access?: ManagerToolAccess | null;
    browser_advanced_features_enabled?: boolean;
    ui_language?: "en" | "fr" | "de" | null;
    ui_preferences?: UiPreferences | null;
    account_links?: {
      account_id: number;
      role: AccountAccessRole;
    }[] | null;
    group_details?: { id: number; name: string }[] | null;
    s3_user_details?: { id: number; name: string }[] | null;
    s3_connection_details?: {
      id: number;
      name: string;
    }[] | null;
    effective_access?: EffectiveUserAccess | null;
    auth_provider?: string | null;
  };
};

type SessionCapabilities = {
  can_manage_iam: boolean;
  can_manage_buckets: boolean;
  can_view_traffic: boolean;
  access_browser: boolean;
  endpoint_url?: string | null;
};

type KeyLoginResponse = {
  access_token: string;
  token_type: string;
  session: {
    session_id: string;
    actor_type: string;
    account_id?: string | null;
    account_name?: string | null;
    user_uid?: string | null;
    capabilities: SessionCapabilities;
  };
};

export async function login(email: string, password: string): Promise<LoginResponse> {
  const formData = new URLSearchParams();
  formData.append("username", email);
  formData.append("password", password);
  formData.append("grant_type", "password");

  const { data } = await client.post<LoginResponse>("/auth/login", formData, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return data;
}

export type LDAPProviderInfo = {
  id: string;
  display_name: string;
};

export async function fetchLdapProviders(): Promise<LDAPProviderInfo[]> {
  const { data } = await client.get<LDAPProviderInfo[]>("/auth/ldap/providers");
  return data;
}

export async function loginWithLdap(
  providerId: string,
  username: string,
  password: string,
): Promise<LoginResponse> {
  const { data } = await client.post<LoginResponse>(`/auth/ldap/${providerId}/login`, {
    username,
    password,
  });
  return data;
}

export async function loginWithKeys(
  accessKey: string,
  secretKey: string,
  endpointUrl?: string,
): Promise<KeyLoginResponse> {
  const { data } = await client.post<KeyLoginResponse>("/auth/login-s3", {
    access_key: accessKey,
    secret_key: secretKey,
    endpoint_url: endpointUrl,
  });
  return data;
}

export type OidcProviderInfo = {
  id: string;
  display_name: string;
  icon_url?: string | null;
};

type OidcStartResponse = {
  provider: string;
  authorization_url: string;
  state: string;
};

type OidcCallbackResponse = LoginResponse & {
  redirect_path?: string | null;
};

export async function fetchOidcProviders(): Promise<OidcProviderInfo[]> {
  const { data } = await client.get<OidcProviderInfo[]>("/auth/oidc/providers");
  return data;
}

export async function startOidcLogin(providerId: string, redirectPath?: string): Promise<OidcStartResponse> {
  const { data } = await client.post<OidcStartResponse>(`/auth/oidc/${providerId}/start`, {
    redirect_path: redirectPath,
  });
  return data;
}

export async function completeOidcLogin(
  providerId: string,
  code: string,
  state: string,
): Promise<OidcCallbackResponse> {
  const { data } = await client.post<OidcCallbackResponse>(`/auth/oidc/${providerId}/callback`, {
    code,
    state,
  });
  return data;
}

export async function logout(): Promise<void> {
  await client.post("/auth/logout");
}

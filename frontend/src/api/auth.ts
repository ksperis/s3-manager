/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type LoginResponse = {
  access_token: string;
  token_type: string;
  user: {
    id: number;
    email: string;
    full_name?: string | null;
    display_name?: string | null;
    picture_url?: string | null;
    role?: string | null;
    is_admin?: boolean;
    is_root?: boolean;
    can_access_ceph_admin?: boolean;
    ui_language?: "en" | "fr" | "de" | null;
    accounts?: number[];
    account_links?: { account_id: number; account_role?: string | null; account_admin?: boolean | null }[] | null;
    auth_provider?: string | null;
  };
};

export type SessionCapabilities = {
  can_manage_iam: boolean;
  can_manage_buckets: boolean;
  can_view_traffic: boolean;
};

export type KeyLoginResponse = {
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

export type OidcStartResponse = {
  provider: string;
  authorization_url: string;
  state: string;
};

export type OidcCallbackResponse = LoginResponse & {
  redirect_path?: string | null;
};

export type RefreshResponse = {
  access_token: string;
  token_type: string;
};

export async function fetchOidcProviders(): Promise<OidcProviderInfo[]> {
  const { data } = await client.get("/auth/oidc/providers");
  if (Array.isArray(data)) {
    return data as OidcProviderInfo[];
  }
  if (data && typeof data === "object") {
    const maybeProviders =
      (data as { providers?: unknown }).providers ??
      (data as { items?: unknown }).items ??
      (data as { data?: unknown }).data;
    if (Array.isArray(maybeProviders)) {
      return maybeProviders as OidcProviderInfo[];
    }
  }
  return [];
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

export async function refreshSession(): Promise<RefreshResponse> {
  const { data } = await client.post<RefreshResponse>("/auth/refresh");
  return data;
}

export async function logout(): Promise<void> {
  await client.post("/auth/logout");
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type OidcProviderSource = "environment" | "ui";

export type OidcProviderFieldLock = {
  forced: boolean;
  source?: string | null;
};

export type LdapProviderSource = "environment" | "ui";

export type LdapProviderFieldLock = {
  forced: boolean;
  source?: string | null;
};

export type OidcProviderAdminItem = {
  provider_id: string;
  display_name: string;
  discovery_url: string;
  client_id: string;
  redirect_uri: string;
  scopes: string[];
  prompt?: string | null;
  enabled: boolean;
  icon_url?: string | null;
  use_pkce: boolean;
  use_nonce: boolean;
  linking_policy: "manual" | "trusted_email";
  trusted_email_domains: string[];
  source: OidcProviderSource;
  editable: boolean;
  field_locks: Record<string, OidcProviderFieldLock>;
  has_client_secret: boolean;
};

export type OidcProviderAdminPayload = {
  provider_id: string;
  display_name: string;
  discovery_url: string;
  client_id: string;
  redirect_uri: string;
  scopes: string[];
  prompt?: string | null;
  enabled: boolean;
  icon_url?: string | null;
  use_pkce: boolean;
  use_nonce: boolean;
  linking_policy: "manual" | "trusted_email";
  trusted_email_domains: string[];
  client_secret?: string | null;
  clear_client_secret?: boolean;
};

export type LdapProviderAdminItem = {
  provider_id: string;
  display_name: string;
  url: string;
  bind_dn?: string | null;
  user_base_dn: string;
  user_filter: string;
  email_attribute: string;
  name_attribute?: string | null;
  subject_attribute?: string | null;
  start_tls: boolean;
  tls_verify: boolean;
  tls_ca_file?: string | null;
  allow_legacy_tls: boolean;
  timeout_seconds: number;
  enabled: boolean;
  allow_insecure: boolean;
  source: LdapProviderSource;
  editable: boolean;
  field_locks: Record<string, LdapProviderFieldLock>;
  has_bind_password: boolean;
};

export type LdapProviderAdminPayload = {
  provider_id: string;
  display_name: string;
  url: string;
  bind_dn?: string | null;
  bind_password?: string | null;
  user_base_dn: string;
  user_filter: string;
  email_attribute: string;
  name_attribute?: string | null;
  subject_attribute?: string | null;
  start_tls: boolean;
  tls_verify: boolean;
  tls_ca_file?: string | null;
  allow_legacy_tls: boolean;
  timeout_seconds: number;
  enabled: boolean;
  allow_insecure: boolean;
  clear_bind_password?: boolean;
};

export async function fetchOidcAdminProviders(): Promise<OidcProviderAdminItem[]> {
  const { data } = await client.get<OidcProviderAdminItem[]>("/admin/settings/oidc/providers");
  return data;
}

export async function createOidcAdminProvider(payload: OidcProviderAdminPayload): Promise<OidcProviderAdminItem> {
  const { data } = await client.post<OidcProviderAdminItem>("/admin/settings/oidc/providers", payload);
  return data;
}

export async function updateOidcAdminProvider(
  providerId: string,
  payload: OidcProviderAdminPayload,
): Promise<OidcProviderAdminItem> {
  const { data } = await client.put<OidcProviderAdminItem>(
    `/admin/settings/oidc/providers/${encodeURIComponent(providerId)}`,
    payload,
  );
  return data;
}

export async function deleteOidcAdminProvider(providerId: string): Promise<void> {
  await client.delete(`/admin/settings/oidc/providers/${encodeURIComponent(providerId)}`);
}

export async function fetchLdapAdminProviders(): Promise<LdapProviderAdminItem[]> {
  const { data } = await client.get<LdapProviderAdminItem[]>("/admin/settings/ldap/providers");
  return data;
}

export async function createLdapAdminProvider(payload: LdapProviderAdminPayload): Promise<LdapProviderAdminItem> {
  const { data } = await client.post<LdapProviderAdminItem>("/admin/settings/ldap/providers", payload);
  return data;
}

export async function updateLdapAdminProvider(
  providerId: string,
  payload: LdapProviderAdminPayload,
): Promise<LdapProviderAdminItem> {
  const { data } = await client.put<LdapProviderAdminItem>(
    `/admin/settings/ldap/providers/${encodeURIComponent(providerId)}`,
    payload,
  );
  return data;
}

export async function deleteLdapAdminProvider(providerId: string): Promise<void> {
  await client.delete(`/admin/settings/ldap/providers/${encodeURIComponent(providerId)}`);
}

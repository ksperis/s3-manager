import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
}));

import {
  createLdapAdminProvider,
  createOidcAdminProvider,
  deleteLdapAdminProvider,
  deleteOidcAdminProvider,
  fetchLdapAdminProviders,
  fetchOidcAdminProviders,
  updateLdapAdminProvider,
  updateOidcAdminProvider,
  type LdapProviderAdminPayload,
  type OidcProviderAdminPayload,
} from "./authSettings";

const payload: OidcProviderAdminPayload = {
  provider_id: "google",
  display_name: "Google",
  discovery_url: "https://accounts.google.com/.well-known/openid-configuration",
  client_id: "client-id",
  redirect_uri: "https://app.example.test/auth/oidc/google/callback",
  scopes: ["openid", "email", "profile"],
  prompt: null,
  enabled: true,
  icon_url: null,
  use_pkce: true,
  use_nonce: true,
  client_secret: "secret",
  clear_client_secret: false,
};

const ldapPayload: LdapProviderAdminPayload = {
  provider_id: "corp",
  display_name: "Corporate LDAP",
  url: "ldaps://ldap.example.test",
  bind_dn: "cn=bucketreef,ou=svc,dc=example,dc=test",
  bind_password: "secret",
  user_base_dn: "ou=people,dc=example,dc=test",
  user_filter: "(uid={username})",
  email_attribute: "mail",
  name_attribute: "displayName",
  subject_attribute: null,
  start_tls: false,
  tls_verify: true,
  tls_ca_file: null,
  allow_legacy_tls: false,
  timeout_seconds: 5,
  enabled: true,
  allow_insecure: false,
  allow_email_linking: false,
  clear_bind_password: false,
};

describe("authSettings api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    clientMock.put.mockReset();
    clientMock.delete.mockReset();
    clientMock.get.mockResolvedValue({ data: [] });
    clientMock.post.mockResolvedValue({ data: { provider_id: "google" } });
    clientMock.put.mockResolvedValue({ data: { provider_id: "google" } });
    clientMock.delete.mockResolvedValue({ data: {} });
  });

  it("lists OIDC providers through the admin settings endpoint", async () => {
    const providers = [{ provider_id: "google" }];
    clientMock.get.mockResolvedValueOnce({ data: providers });

    await expect(fetchOidcAdminProviders()).resolves.toBe(providers);
    expect(clientMock.get).toHaveBeenCalledWith("/admin/settings/oidc/providers");
  });

  it("creates and updates OIDC providers through admin settings endpoints", async () => {
    await createOidcAdminProvider(payload);
    await updateOidcAdminProvider("provider with space", payload);

    expect(clientMock.post).toHaveBeenCalledWith("/admin/settings/oidc/providers", payload);
    expect(clientMock.put).toHaveBeenCalledWith("/admin/settings/oidc/providers/provider%20with%20space", payload);
  });

  it("deletes OIDC providers through the encoded admin settings endpoint", async () => {
    await deleteOidcAdminProvider("provider with space");

    expect(clientMock.delete).toHaveBeenCalledWith("/admin/settings/oidc/providers/provider%20with%20space");
  });

  it("lists LDAP providers through the admin settings endpoint", async () => {
    const providers = [{ provider_id: "corp" }];
    clientMock.get.mockResolvedValueOnce({ data: providers });

    await expect(fetchLdapAdminProviders()).resolves.toBe(providers);
    expect(clientMock.get).toHaveBeenCalledWith("/admin/settings/ldap/providers");
  });

  it("creates and updates LDAP providers through admin settings endpoints", async () => {
    await createLdapAdminProvider(ldapPayload);
    await updateLdapAdminProvider("provider with space", ldapPayload);

    expect(clientMock.post).toHaveBeenCalledWith("/admin/settings/ldap/providers", ldapPayload);
    expect(clientMock.put).toHaveBeenCalledWith("/admin/settings/ldap/providers/provider%20with%20space", ldapPayload);
  });

  it("deletes LDAP providers through the encoded admin settings endpoint", async () => {
    await deleteLdapAdminProvider("provider with space");

    expect(clientMock.delete).toHaveBeenCalledWith("/admin/settings/ldap/providers/provider%20with%20space");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
}));

import { fetchLdapProviders, fetchOidcProviders } from "./auth";

describe("auth provider API", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
  });

  it("returns the canonical LDAP provider list", async () => {
    const providers = [{ id: "corp", display_name: "Corporate LDAP" }];
    clientMock.get.mockResolvedValue({ data: providers });

    await expect(fetchLdapProviders()).resolves.toEqual(providers);
    expect(clientMock.get).toHaveBeenCalledWith("/auth/ldap/providers");
  });

  it("returns the canonical OIDC provider list", async () => {
    const providers = [
      {
        id: "workforce",
        display_name: "Workforce SSO",
        icon_url: "https://id.example.test/icon.svg",
      },
    ];
    clientMock.get.mockResolvedValue({ data: providers });

    await expect(fetchOidcProviders()).resolves.toEqual(providers);
    expect(clientMock.get).toHaveBeenCalledWith("/auth/oidc/providers");
  });
});

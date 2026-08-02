import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
  timeoutForRequestProfile: () => 15_000,
}));

import { fetchBrandingSettings, fetchLoginSettings } from "./appSettings";

describe("public settings API", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
  });

  it("returns the canonical login settings response unchanged", async () => {
    const settings = {
      allow_login_access_keys: true,
      allow_login_endpoint_list: true,
      allow_login_custom_endpoint: false,
      default_endpoint_url: "https://s3.example.test",
      endpoints: [],
      login_logo_url: null,
      seed_login_prefill: false,
      seed_login_email: null,
      seed_login_password: null,
    };
    clientMock.get.mockResolvedValue({ data: settings });

    await expect(fetchLoginSettings()).resolves.toBe(settings);
    expect(clientMock.get).toHaveBeenCalledWith("/settings/login", { timeout: 15_000 });
  });

  it("returns the canonical branding response unchanged", async () => {
    const settings = { primary_color: "#123abc", login_logo_url: null };
    clientMock.get.mockResolvedValue({ data: settings });

    await expect(fetchBrandingSettings()).resolves.toBe(settings);
    expect(clientMock.get).toHaveBeenCalledWith("/settings/branding");
  });
});

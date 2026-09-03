import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  timeoutForRequestProfile: vi.fn(() => 1234),
}));

vi.mock("./client", () => ({
  default: {
    get: mocks.get,
    put: mocks.put,
  },
  timeoutForRequestProfile: mocks.timeoutForRequestProfile,
}));

import {
  fetchPortalProjectSettings,
  fetchPortalState,
  listPortalAccounts,
  updatePortalProjectSettings,
} from "./portalAccounts";

describe("portal accounts api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists accounts with the interactive timeout and caller signal", async () => {
    const accounts = [{ id: 101, name: "Research" }];
    const controller = new AbortController();
    mocks.get.mockResolvedValue({ data: accounts });

    await expect(listPortalAccounts({ signal: controller.signal })).resolves.toBe(accounts);

    expect(mocks.timeoutForRequestProfile).toHaveBeenCalledWith("interactive");
    expect(mocks.get).toHaveBeenCalledWith("/portal/accounts", {
      signal: controller.signal,
      timeout: 1234,
    });
  });

  it("loads Portal state in the selected account", async () => {
    const state = { can_manage_buckets: true };
    mocks.get.mockResolvedValue({ data: state });

    await expect(fetchPortalState("101")).resolves.toBe(state);

    expect(mocks.get).toHaveBeenCalledWith("/portal/state", {
      params: { account_id: "101" },
    });
  });

  it("loads project settings in the selected account", async () => {
    const settings = { effective: {}, project_override: {}, can_update: true };
    mocks.get.mockResolvedValue({ data: settings });

    await expect(fetchPortalProjectSettings("101")).resolves.toBe(settings);

    expect(mocks.get).toHaveBeenCalledWith("/portal/settings", {
      params: { account_id: "101" },
    });
  });

  it("updates project settings in the selected account", async () => {
    const payload = { allow_portal_user_access_key_create: false };
    const settings = { effective: payload, project_override: payload, can_update: true };
    mocks.put.mockResolvedValue({ data: settings });

    await expect(updatePortalProjectSettings("101", payload)).resolves.toBe(settings);

    expect(mocks.put).toHaveBeenCalledWith("/portal/settings", payload, {
      params: { account_id: "101" },
    });
  });
});

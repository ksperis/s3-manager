import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./client", () => ({ default: clientMock }));

import {
  createCephAdminAccount,
  getCephAdminAccountDetail,
  listCephAdminAccounts,
  updateCephAdminAccountConfig,
} from "./cephAdminAccounts";

describe("Ceph Admin accounts api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    clientMock.put.mockReset();
    clientMock.get.mockResolvedValue({ data: {} });
    clientMock.post.mockResolvedValue({ data: {} });
    clientMock.put.mockResolvedValue({ data: {} });
  });

  it("normalizes account listing includes and preserves cancellation", async () => {
    const signal = new AbortController().signal;

    await listCephAdminAccounts(
      7,
      { page: 2, page_size: 25, include: ["quota", "usage"] },
      { signal },
    );

    expect(clientMock.get).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/accounts",
      {
        params: { page: 2, page_size: 25, include: "quota,usage" },
        signal,
      },
    );
  });

  it("uses encoded account resources for detail and configuration", async () => {
    const payload = { account_name: "Research" };

    await getCephAdminAccountDetail(7, "account/one");
    await createCephAdminAccount(7, payload);
    await updateCephAdminAccountConfig(7, "account/one", payload);

    expect(clientMock.get).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/accounts/account%2Fone/detail",
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/accounts",
      payload,
    );
    expect(clientMock.put).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/accounts/account%2Fone/config",
      payload,
    );
  });
});

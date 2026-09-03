import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./client", () => ({ default: clientMock }));

import {
  createCephAdminUser,
  getCephAdminUserDetail,
  listCephAdminUsers,
  updateCephAdminUserConfig,
} from "./cephAdminUsers";

describe("Ceph Admin users api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    clientMock.put.mockReset();
    clientMock.get.mockResolvedValue({ data: {} });
    clientMock.post.mockResolvedValue({ data: {} });
    clientMock.put.mockResolvedValue({ data: {} });
  });

  it("normalizes user listing includes and preserves cancellation", async () => {
    const signal = new AbortController().signal;

    await listCephAdminUsers(
      7,
      { page: 3, page_size: 50, include: ["quota", "keys"] },
      { signal },
    );

    expect(clientMock.get).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/users",
      {
        params: { page: 3, page_size: 50, include: "quota,keys" },
        signal,
      },
    );
  });

  it("uses encoded tenant-scoped user resources", async () => {
    const payload = { display_name: "Research User" };

    await getCephAdminUserDetail(7, "team/user", "tenant-a");
    await createCephAdminUser(7, { uid: "team/user" });
    await updateCephAdminUserConfig(7, "team/user", payload, "tenant-a");

    expect(clientMock.get).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/users/team%2Fuser/detail",
      { params: { tenant: "tenant-a" } },
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/users",
      { uid: "team/user" },
    );
    expect(clientMock.put).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/users/team%2Fuser/config",
      payload,
      { params: { tenant: "tenant-a" } },
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("./client", () => ({ default: clientMock }));

import {
  fetchCephAdminClusterStorage,
  fetchCephAdminClusterTraffic,
  getCephAdminAccountMetrics,
  getCephAdminUserMetrics,
} from "./cephAdminMetrics";

describe("Ceph Admin metrics api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.get.mockResolvedValue({ data: {} });
  });

  it("targets encoded account and user metric resources", async () => {
    await getCephAdminAccountMetrics(7, "account/one");
    await getCephAdminUserMetrics(7, "tenant$user", "tenant-a");

    expect(clientMock.get).toHaveBeenNthCalledWith(
      1,
      "/ceph-admin/endpoints/7/accounts/account%2Fone/metrics",
    );
    expect(clientMock.get).toHaveBeenNthCalledWith(
      2,
      "/ceph-admin/endpoints/7/users/tenant%24user/metrics",
      { params: { tenant: "tenant-a" } },
    );
  });

  it("uses canonical cluster storage and traffic queries", async () => {
    await fetchCephAdminClusterStorage(9);
    await fetchCephAdminClusterTraffic(9, "month", "archive");
    await fetchCephAdminClusterTraffic(9);

    expect(clientMock.get).toHaveBeenNthCalledWith(
      1,
      "/ceph-admin/endpoints/9/metrics/storage",
    );
    expect(clientMock.get).toHaveBeenNthCalledWith(
      2,
      "/ceph-admin/endpoints/9/metrics/traffic",
      { params: { window: "month", bucket: "archive" } },
    );
    expect(clientMock.get).toHaveBeenNthCalledWith(
      3,
      "/ceph-admin/endpoints/9/metrics/traffic",
      { params: { window: "week", bucket: undefined } },
    );
  });
});

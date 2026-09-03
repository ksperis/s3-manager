import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./client", () => ({ default: clientMock }));

import {
  deleteCephAdminBucketPolicy,
  listCephAdminBucketObjects,
  putCephAdminBucketLifecycle,
  updateCephAdminBucketQuota,
} from "./cephAdminBucketDetails";

describe("Ceph Admin bucket details api", () => {
  beforeEach(() => {
    clientMock.delete.mockReset();
    clientMock.get.mockReset();
    clientMock.put.mockReset();
    clientMock.get.mockResolvedValue({ data: { objects: [] } });
    clientMock.put.mockResolvedValue({ data: { rules: [] } });
  });

  it("encodes bucket names and preserves object prefixes", async () => {
    await listCephAdminBucketObjects(7, "reports/2026", "incoming/");

    expect(clientMock.get).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/buckets/reports%2F2026/objects",
      { params: { prefix: "incoming/" } },
    );
  });

  it("keeps configuration payloads on the bucket detail path", async () => {
    const rules = [{ ID: "archive" }];

    await putCephAdminBucketLifecycle(7, "reports/2026", rules);
    await updateCephAdminBucketQuota(7, "reports/2026", {
      max_objects: 100,
    });

    expect(clientMock.put).toHaveBeenNthCalledWith(
      1,
      "/ceph-admin/endpoints/7/buckets/reports%2F2026/lifecycle",
      { rules },
    );
    expect(clientMock.put).toHaveBeenNthCalledWith(
      2,
      "/ceph-admin/endpoints/7/buckets/reports%2F2026/quota",
      { max_objects: 100 },
    );
  });

  it("keeps configuration deletes on the bucket detail path", async () => {
    await deleteCephAdminBucketPolicy(7, "reports/2026");

    expect(clientMock.delete).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/buckets/reports%2F2026/policy",
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./client", () => ({ default: clientMock }));

import {
  browserBucketDetails,
  deleteBucketPolicy,
  getBucketStats,
  putBucketPolicy,
} from "./bucketDetails";

describe("bucket details api", () => {
  beforeEach(() => {
    clientMock.delete.mockReset();
    clientMock.get.mockReset();
    clientMock.put.mockReset();
    clientMock.get.mockResolvedValue({ data: {} });
    clientMock.put.mockResolvedValue({ data: {} });
  });

  it("keeps named detail operations on the manager route", async () => {
    await getBucketStats("account-a", "reports/2026", {
      with_stats: true,
    });

    expect(clientMock.get).toHaveBeenCalledWith(
      "/manager/buckets/reports%2F2026/stats",
      { params: { with_stats: true, account_id: "account-a" } },
    );
  });

  it("exposes the browser detail route explicitly", async () => {
    await browserBucketDetails.getBucketProperties(7, "reports/2026");

    expect(clientMock.get).toHaveBeenCalledWith(
      "/browser/buckets/config/reports%2F2026/properties",
      { params: { account_id: 7 } },
    );
  });

  it("keeps manager writes and deletes on their detail resource", async () => {
    const policy = { Version: "2012-10-17", Statement: [] };

    await putBucketPolicy(7, "reports/2026", policy);
    await deleteBucketPolicy(7, "reports/2026");

    expect(clientMock.put).toHaveBeenCalledWith(
      "/manager/buckets/reports%2F2026/policy",
      { policy },
      { params: { account_id: 7 } },
    );
    expect(clientMock.delete).toHaveBeenCalledWith(
      "/manager/buckets/reports%2F2026/policy",
      { params: { account_id: 7 } },
    );
  });
});

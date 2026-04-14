import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
}));

vi.mock("./sseBucketsStream", () => ({
  resolveApiBaseUrl: vi.fn(() => "/api"),
  streamBucketsWithSse: vi.fn(),
}));

import {
  BUCKET_LISTING_POST_QUERY_THRESHOLD,
  buildBucketListingQuery,
  shouldUsePostBucketListing,
} from "./bucketListingTransport";
import { listCephAdminBuckets } from "./cephAdmin";
import { listStorageOpsBuckets } from "./storageOps";

const emptyResponse = {
  items: [],
  total: 0,
  page: 1,
  page_size: 25,
  has_next: false,
};

function buildLongAdvancedFilter(size: number) {
  return JSON.stringify({
    match: "all",
    rules: [
      {
        field: "name",
        op: "in",
        value: Array.from({ length: size }, (_, index) => `bucket-${String(index).padStart(4, "0")}`),
      },
    ],
  });
}

describe("bucket listing transport", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    clientMock.get.mockResolvedValue({ data: emptyResponse });
    clientMock.post.mockResolvedValue({ data: emptyResponse });
  });

  it("uses GET for short Ceph Admin listing payloads", async () => {
    const params = {
      page: 1,
      page_size: 25,
      advanced_filter: '{"match":"all","rules":[{"field":"name","op":"eq","value":"bucket-a"}]}',
      with_stats: true,
    } as const;

    expect(shouldUsePostBucketListing(params)).toBe(false);

    await listCephAdminBuckets(7, params);

    expect(clientMock.get).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/buckets",
      expect.objectContaining({
        params: expect.any(URLSearchParams),
      })
    );
    const config = clientMock.get.mock.calls[0]?.[1];
    expect(config?.params.toString()).toContain("advanced_filter=");
    expect(clientMock.post).not.toHaveBeenCalled();
  });

  it("uses POST for oversized Ceph Admin listing payloads", async () => {
    const params = {
      page: 1,
      page_size: 25,
      advanced_filter: buildLongAdvancedFilter(600),
      include: ["owner_name", "owner_quota"],
      with_stats: false,
    };

    expect(buildBucketListingQuery(params).toString().length).toBeGreaterThan(BUCKET_LISTING_POST_QUERY_THRESHOLD);
    expect(shouldUsePostBucketListing(params)).toBe(true);

    await listCephAdminBuckets(7, params);

    expect(clientMock.post).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/buckets/query",
      expect.objectContaining({
        advanced_filter: params.advanced_filter,
        include: ["owner_name", "owner_quota"],
        with_stats: false,
      }),
      expect.any(Object)
    );
    expect(clientMock.get).not.toHaveBeenCalled();
  });

  it("uses POST for oversized Storage Ops listing payloads", async () => {
    const params = {
      page: 1,
      page_size: 25,
      advanced_filter: buildLongAdvancedFilter(600),
      with_stats: false,
    };

    expect(shouldUsePostBucketListing(params)).toBe(true);

    await listStorageOpsBuckets(1, params);

    expect(clientMock.post).toHaveBeenCalledWith(
      "/storage-ops/buckets/query",
      expect.objectContaining({
        advanced_filter: params.advanced_filter,
        with_stats: false,
      }),
      expect.any(Object)
    );
    expect(clientMock.get).not.toHaveBeenCalled();
  });
});

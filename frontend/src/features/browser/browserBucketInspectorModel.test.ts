import { beforeEach, describe, expect, it, vi } from "vitest";

import { browserBucketDetails } from "../../api/bucketDetails";

import {
  buildBucketInspectorFeatures,
  fetchBucketInspectorData,
} from "./browserBucketInspectorModel";

vi.mock("../../api/bucketDetails", () => ({
  browserBucketDetails: {
    getBucketLogging: vi.fn(),
    getBucketPolicy: vi.fn(),
    getBucketProperties: vi.fn(),
    getBucketStats: vi.fn(),
    getBucketWebsite: vi.fn(),
  },
}));

beforeEach(() => vi.resetAllMocks());

describe("browser bucket inspector model", () => {
  it("orders known features before unknown backend features", () => {
    expect(
      buildBucketInspectorFeatures({
        features: {
          custom_archive: { state: "Ready", tone: "active" },
          cors: { state: "Disabled", tone: "inactive" },
          versioning: { state: "Enabled", tone: "active" },
        },
      }),
    ).toEqual([
      { key: "versioning", label: "Versioning", state: "Enabled", tone: "active" },
      { key: "cors", label: "CORS", state: "Disabled", tone: "inactive" },
      { key: "custom_archive", label: "Custom Archive", state: "Ready", tone: "active" },
    ]);
  });

  it("returns no features without inspector data", () => {
    expect(buildBucketInspectorFeatures(null)).toEqual([]);
  });

  it("loads and normalizes bucket stats and feature states", async () => {
    vi.mocked(browserBucketDetails.getBucketStats).mockResolvedValue({
      name: "archive",
      creation_date: "2026-08-02T10:00:00.000Z",
      used_bytes: 128,
      object_count: 3,
      quota_max_size_bytes: 1024,
      quota_max_objects: null,
    } as never);
    vi.mocked(browserBucketDetails.getBucketProperties).mockResolvedValue({
      versioning_status: "Suspended",
      object_lock: { enabled: true },
      public_access_block: {
        block_public_acls: true,
        ignore_public_acls: false,
        block_public_policy: false,
        restrict_public_buckets: false,
      },
      lifecycle_rules: [{ ID: "expire" }],
      cors_rules: [],
    } as never);
    vi.mocked(browserBucketDetails.getBucketPolicy).mockResolvedValue({
      policy: { Version: "2012-10-17", Statement: [] },
    } as never);
    vi.mocked(browserBucketDetails.getBucketLogging).mockResolvedValue({
      enabled: true,
      target_bucket: "logs",
    } as never);
    vi.mocked(browserBucketDetails.getBucketWebsite).mockResolvedValue({
      index_document: "index.html",
      routing_rules: [],
    } as never);

    const data = await fetchBucketInspectorData({
      accountId: 7,
      bucketName: "archive",
      includeUsage: true,
      includeStaticWebsite: true,
    });

    expect(browserBucketDetails.getBucketStats).toHaveBeenCalledWith(7, "archive", {
      with_stats: true,
    });
    expect(data).toMatchObject({
      used_bytes: 128,
      object_count: 3,
      quota_max_size_bytes: 1024,
      features: {
        versioning: { state: "Suspended", tone: "unknown" },
        object_lock: { state: "Enabled", tone: "active" },
        block_public_access: { state: "Partial", tone: "active" },
        lifecycle_rules: { state: "Enabled", tone: "active" },
        cors: { state: "Not set", tone: "inactive" },
        bucket_policy: { state: "Configured", tone: "active" },
        access_logging: { state: "Enabled", tone: "active" },
        static_website: { state: "Enabled", tone: "active" },
        quota: { state: "Configured", tone: "active" },
      },
    });
  });

  it("keeps independent feature failures visible as unavailable", async () => {
    vi.mocked(browserBucketDetails.getBucketStats).mockRejectedValue(new Error("stats"));
    vi.mocked(browserBucketDetails.getBucketProperties).mockRejectedValue(new Error("properties"));
    vi.mocked(browserBucketDetails.getBucketPolicy).mockRejectedValue(new Error("policy"));
    vi.mocked(browserBucketDetails.getBucketLogging).mockRejectedValue(new Error("logging"));

    const data = await fetchBucketInspectorData({
      accountId: 7,
      bucketName: "archive",
      includeUsage: false,
      includeStaticWebsite: false,
    });

    expect(browserBucketDetails.getBucketWebsite).not.toHaveBeenCalled();
    expect(Object.values(data.features)).toEqual(
      expect.arrayContaining([
        { state: "Unavailable", tone: "unknown" },
      ]),
    );
    expect(data.features.static_website).toEqual({
      state: "Unavailable",
      tone: "unknown",
    });
    expect(data.features.quota).toEqual({
      state: "Unavailable",
      tone: "unknown",
    });
  });
});

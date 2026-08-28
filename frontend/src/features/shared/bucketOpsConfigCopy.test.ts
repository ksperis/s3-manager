/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BULK_COPY_FEATURE_SELECTION,
  type BulkCopyFeatureSelection,
} from "./bucketBulkOperationsModel";
import { copyBucketOpsConfigs } from "./bucketOpsConfigCopy";

function createApi() {
  return {
    fetchBucketQuota: vi.fn(async () => ({ maxSizeBytes: 1024, maxObjects: 5 })),
    getBucketCors: vi.fn(async () => ({ rules: [{ ID: "cors" }] })),
    getBucketLifecycle: vi.fn(async () => ({ rules: [{ ID: "lifecycle" }] })),
    getBucketLogging: vi.fn(async () => ({
      enabled: true,
      target_bucket: "logs",
      target_prefix: "audit/",
    })),
    getBucketPolicy: vi.fn(async () => ({ policy: { Statement: [] } })),
    getBucketProperties: vi.fn(async () => ({
      lifecycle_rules: [],
      object_lock_enabled: true,
      object_lock: { enabled: true, mode: "GOVERNANCE", days: 3 },
      versioning_status: "Enabled",
    })),
    getBucketPublicAccessBlock: vi.fn(async () => ({
      block_public_acls: true,
      ignore_public_acls: true,
      block_public_policy: false,
      restrict_public_buckets: false,
    })),
  };
}

const copy = (
  features: BulkCopyFeatureSelection,
  overrides: Partial<Parameters<typeof copyBucketOpsConfigs>[0]> = {},
) => {
  const api = createApi();
  return {
    api,
    result: copyBucketOpsConfigs({
      ...api,
      bucketNames: ["zulu", "alpha"],
      copiedAt: "2026-08-28T12:00:00.000Z",
      features,
      isStorageOps: false,
      sourceEndpointId: 7,
      sourceEndpointName: "Primary",
      ...overrides,
    }),
  };
};

describe("copyBucketOpsConfigs", () => {
  it("copies and normalizes every selected configuration", async () => {
    const features = Object.fromEntries(
      Object.keys(DEFAULT_BULK_COPY_FEATURE_SELECTION).map((feature) => [feature, true]),
    ) as BulkCopyFeatureSelection;
    const onProgress = vi.fn();
    const { api, result } = copy(features, { bucketNames: ["alpha"], onProgress });

    await expect(result).resolves.toEqual({
      kind: "success",
      clipboard: {
        version: 1,
        copiedAt: "2026-08-28T12:00:00.000Z",
        sourceEndpointId: 7,
        sourceEndpointName: "Primary",
        features,
        buckets: [
          {
            name: "alpha",
            quota: { maxSizeBytes: 1024, maxObjects: 5 },
            versioningEnabled: true,
            objectLock: { enabled: true, mode: "GOVERNANCE", days: 3, years: null },
            publicAccessBlock: {
              block_public_acls: true,
              ignore_public_acls: true,
              block_public_policy: false,
              restrict_public_buckets: false,
            },
            lifecycleRules: [{ ID: "lifecycle" }],
            corsRules: [{ ID: "cors" }],
            policy: { Statement: [] },
            accessLogging: {
              enabled: true,
              target_bucket: "logs",
              target_prefix: "audit/",
            },
          },
        ],
      },
      summary:
        "Copied Quota, Versioning, Object Lock, Block public access, Lifecycle rules, CORS, Bucket policy, Access logging from 1 bucket(s).",
    });
    expect(api.getBucketProperties).toHaveBeenCalledWith(7, "alpha");
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 1, total: 1, failed: 0 });
  });

  it("omits unsupported quota copies for Storage Ops", async () => {
    const features = {
      ...DEFAULT_BULK_COPY_FEATURE_SELECTION,
      quota: true,
      versioning: true,
    };
    const { api, result } = copy(features, { isStorageOps: true });

    const outcome = await result;
    expect(outcome.kind).toBe("success");
    if (outcome.kind === "error") throw new Error(outcome.error);
    expect(outcome.clipboard.features.quota).toBe(false);
    expect(outcome.clipboard.buckets.map((bucket) => bucket.name)).toEqual(["alpha", "zulu"]);
    expect(api.fetchBucketQuota).not.toHaveBeenCalled();
    expect(outcome.summary).toBe("Copied Versioning from 2 bucket(s).");
  });

  it("rejects an empty effective feature selection", async () => {
    const { api, result } = copy(DEFAULT_BULK_COPY_FEATURE_SELECTION);

    await expect(result).resolves.toEqual({
      kind: "error",
      error: "Select at least one configuration to copy.",
    });
    expect(api.getBucketProperties).not.toHaveBeenCalled();
  });

  it("reports settled source failures and does not return a partial clipboard", async () => {
    const onProgress = vi.fn();
    const features = {
      ...DEFAULT_BULK_COPY_FEATURE_SELECTION,
      versioning: true,
    };
    const api = createApi();
    api.getBucketProperties.mockImplementation(async (_endpointId, bucketName) => {
      if (bucketName === "zulu") throw new Error("Unavailable");
      return { lifecycle_rules: [], versioning_status: "Enabled" };
    });
    const result = copyBucketOpsConfigs({
      ...api,
      bucketNames: ["zulu", "alpha"],
      copiedAt: "2026-08-28T12:00:00.000Z",
      features,
      isStorageOps: false,
      onProgress,
      sourceEndpointId: 7,
      sourceEndpointName: "Primary",
    });

    await expect(result).resolves.toEqual({
      kind: "error",
      error: "1 source bucket(s) failed while copying configs.",
    });
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 2, total: 2, failed: 1 });
  });
});

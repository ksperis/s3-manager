/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BULK_COPY_FEATURE_SELECTION,
  type BulkConfigClipboard,
  type BulkConfigClipboardBucket,
  type BulkCopyFeatureSelection,
} from "./bucketBulkOperationsModel";
import { applyBucketOpsConfigPaste } from "./bucketOpsConfigPaste";

function createApi() {
  return {
    deleteBucketCors: vi.fn(async () => undefined),
    deleteBucketLifecycle: vi.fn(async () => undefined),
    deleteBucketLogging: vi.fn(async () => undefined),
    deleteBucketPolicy: vi.fn(async () => undefined),
    fetchBucketQuota: vi.fn(async () => ({ maxSizeBytes: null, maxObjects: null })),
    getBucketCors: vi.fn(async () => ({ rules: [{ ID: "old-cors" }] })),
    getBucketLifecycle: vi.fn(async () => ({ rules: [{ ID: "old-lifecycle" }] })),
    getBucketLogging: vi.fn(async () => ({
      enabled: false,
      target_bucket: null,
      target_prefix: null,
    })),
    getBucketPolicy: vi.fn(async () => ({ policy: { Statement: [{ Sid: "Old" }] } })),
    getBucketProperties: vi.fn(async () => ({
      lifecycle_rules: [],
      object_lock_enabled: false,
      object_lock: { enabled: false },
      versioning_status: "Suspended",
    })),
    getBucketPublicAccessBlock: vi.fn(async () => ({
      block_public_acls: false,
      ignore_public_acls: false,
      block_public_policy: false,
      restrict_public_buckets: false,
    })),
    putBucketCors: vi.fn(async () => undefined),
    putBucketLifecycle: vi.fn(async () => undefined),
    putBucketLogging: vi.fn(async () => undefined),
    putBucketPolicy: vi.fn(async () => undefined),
    setBucketVersioning: vi.fn(async () => undefined),
    updateBucketObjectLock: vi.fn(async () => undefined),
    updateBucketPublicAccessBlock: vi.fn(async () => undefined),
    updateBucketQuota: vi.fn(async () => undefined),
  };
}

const allFeatures = Object.fromEntries(
  Object.keys(DEFAULT_BULK_COPY_FEATURE_SELECTION).map((feature) => [feature, true]),
) as BulkCopyFeatureSelection;

function createSource(
  overrides: Partial<BulkConfigClipboardBucket> = {},
): BulkConfigClipboardBucket {
  return {
    name: "source",
    quota: { maxSizeBytes: 1024 ** 3, maxObjects: 25 },
    versioningEnabled: true,
    objectLock: { enabled: true, mode: "GOVERNANCE", days: 7, years: null },
    publicAccessBlock: {
      block_public_acls: true,
      ignore_public_acls: true,
      block_public_policy: true,
      restrict_public_buckets: true,
    },
    lifecycleRules: [{ ID: "copied-lifecycle" }],
    corsRules: [{ ID: "copied-cors" }],
    policy: { Statement: [{ Sid: "Copied" }] },
    accessLogging: {
      enabled: true,
      target_bucket: "audit-logs",
      target_prefix: "buckets/",
    },
    ...overrides,
  };
}

function createClipboard(
  features: BulkCopyFeatureSelection,
  source = createSource(),
): BulkConfigClipboard {
  return {
    version: 1,
    copiedAt: "2026-08-28T14:00:00.000Z",
    sourceEndpointId: 3,
    sourceEndpointName: "Source",
    features,
    buckets: [source],
  };
}

function apply(
  features: BulkCopyFeatureSelection,
  options: {
    api?: ReturnType<typeof createApi>;
    isStorageOps?: boolean;
    sources?: BulkConfigClipboardBucket[];
  } = {},
) {
  const api = options.api ?? createApi();
  const sources = options.sources ?? [createSource()];
  const clipboard = createClipboard(features, sources[0]);
  clipboard.buckets = sources;
  const mappings = sources.map((source, index) => ({
    sourceBucket: source.name,
    destinationBucket: `destination-${index + 1}`,
    sourceConfig: source,
  }));
  const onProgress = vi.fn();
  const result = applyBucketOpsConfigPaste({
    ...api,
    clipboard,
    isStorageOps: options.isStorageOps ?? false,
    mappings,
    onProgress,
    targetEndpointId: 7,
  });
  return { api, onProgress, result };
}

describe("applyBucketOpsConfigPaste", () => {
  it("applies each changed copied configuration", async () => {
    const { api, onProgress, result } = apply(allFeatures);

    await expect(result).resolves.toEqual({
      changedCount: 1,
      unchangedCount: 0,
      failedCount: 0,
      error: null,
      summary: "Updated 1 bucket.",
    });
    expect(api.updateBucketQuota).toHaveBeenCalledWith(7, "destination-1", {
      max_size_gb: 1,
      max_size_unit: "GiB",
      max_objects: 25,
    });
    expect(api.setBucketVersioning).toHaveBeenCalledWith(7, "destination-1", true);
    expect(api.updateBucketObjectLock).toHaveBeenCalledWith(
      7,
      "destination-1",
      expect.objectContaining({ enabled: true, mode: "GOVERNANCE" }),
    );
    expect(api.updateBucketPublicAccessBlock).toHaveBeenCalledWith(
      7,
      "destination-1",
      expect.objectContaining({ block_public_acls: true }),
    );
    expect(api.putBucketLifecycle).toHaveBeenCalledWith(
      7,
      "destination-1",
      [{ ID: "copied-lifecycle" }],
    );
    expect(api.putBucketCors).toHaveBeenCalledWith(
      7,
      "destination-1",
      [{ ID: "copied-cors" }],
    );
    expect(api.putBucketPolicy).toHaveBeenCalledWith(
      7,
      "destination-1",
      { Statement: [{ Sid: "Copied" }] },
    );
    expect(api.putBucketLogging).toHaveBeenCalledWith(7, "destination-1", {
      enabled: true,
      target_bucket: "audit-logs",
      target_prefix: "buckets/",
    });
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 1, total: 1, failed: 0 });
  });

  it("skips every mutation when the destination already matches", async () => {
    const api = createApi();
    api.fetchBucketQuota.mockResolvedValue({ maxSizeBytes: 1024 ** 3, maxObjects: 25 });
    api.getBucketCors.mockResolvedValue({ rules: [{ ID: "copied-cors" }] });
    api.getBucketLifecycle.mockResolvedValue({ rules: [{ ID: "copied-lifecycle" }] });
    api.getBucketLogging.mockResolvedValue({
      enabled: true,
      target_bucket: "audit-logs",
      target_prefix: "buckets/",
    });
    api.getBucketPolicy.mockResolvedValue({ policy: { Statement: [{ Sid: "Copied" }] } });
    api.getBucketProperties.mockResolvedValue({
      lifecycle_rules: [],
      object_lock_enabled: true,
      object_lock: { enabled: true, mode: "GOVERNANCE", days: 7 },
      versioning_status: "Enabled",
    });
    api.getBucketPublicAccessBlock.mockResolvedValue({
      block_public_acls: true,
      ignore_public_acls: true,
      block_public_policy: true,
      restrict_public_buckets: true,
    });

    const { result } = apply(allFeatures, { api });

    await expect(result).resolves.toEqual({
      changedCount: 0,
      unchangedCount: 1,
      failedCount: 0,
      error: null,
      summary: "Updated 0 buckets (1 unchanged).",
    });
    expect(api.updateBucketQuota).not.toHaveBeenCalled();
    expect(api.setBucketVersioning).not.toHaveBeenCalled();
    expect(api.updateBucketObjectLock).not.toHaveBeenCalled();
    expect(api.updateBucketPublicAccessBlock).not.toHaveBeenCalled();
    expect(api.putBucketLifecycle).not.toHaveBeenCalled();
    expect(api.putBucketCors).not.toHaveBeenCalled();
    expect(api.putBucketPolicy).not.toHaveBeenCalled();
    expect(api.putBucketLogging).not.toHaveBeenCalled();
  });

  it("deletes destination configurations copied as empty or disabled", async () => {
    const features = {
      ...DEFAULT_BULK_COPY_FEATURE_SELECTION,
      lifecycle: true,
      cors: true,
      policy: true,
      access_logging: true,
    };
    const source = createSource({
      lifecycleRules: [],
      corsRules: [],
      policy: null,
      accessLogging: { enabled: false, target_bucket: null, target_prefix: null },
    });
    const api = createApi();
    api.getBucketLogging.mockResolvedValue({
      enabled: true,
      target_bucket: "old-logs",
      target_prefix: "old/",
    });

    const { result } = apply(features, { api, sources: [source] });

    await expect(result).resolves.toMatchObject({ changedCount: 1, failedCount: 0 });
    expect(api.deleteBucketLifecycle).toHaveBeenCalledWith(7, "destination-1");
    expect(api.deleteBucketCors).toHaveBeenCalledWith(7, "destination-1");
    expect(api.deleteBucketPolicy).toHaveBeenCalledWith(7, "destination-1");
    expect(api.deleteBucketLogging).toHaveBeenCalledWith(7, "destination-1");
  });

  it("aggregates partial failures without hiding successful destinations", async () => {
    const features = {
      ...DEFAULT_BULK_COPY_FEATURE_SELECTION,
      versioning: true,
    };
    const api = createApi();
    api.getBucketProperties.mockImplementation(async (_endpointId, bucketName) => {
      if (bucketName === "destination-2") throw new Error("Unavailable");
      return { lifecycle_rules: [], versioning_status: "Suspended" };
    });
    const sources = [createSource({ name: "first" }), createSource({ name: "second" })];
    const { onProgress, result } = apply(features, { api, sources });

    await expect(result).resolves.toEqual({
      changedCount: 1,
      unchangedCount: 0,
      failedCount: 1,
      error: "1 bucket(s) failed to update.",
      summary: "Updated 1 bucket.",
    });
    expect(api.setBucketVersioning).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 2, total: 2, failed: 1 });
  });

  it("does not apply copied quota through Storage Ops", async () => {
    const features = {
      ...DEFAULT_BULK_COPY_FEATURE_SELECTION,
      quota: true,
    };
    const { api, result } = apply(features, { isStorageOps: true });

    await expect(result).resolves.toMatchObject({
      changedCount: 0,
      unchangedCount: 1,
      failedCount: 0,
    });
    expect(api.fetchBucketQuota).not.toHaveBeenCalled();
    expect(api.updateBucketQuota).not.toHaveBeenCalled();
  });
});

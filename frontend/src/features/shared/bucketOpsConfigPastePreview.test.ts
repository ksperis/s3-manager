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
import { buildBulkPreviewSections } from "./bucketBulkPreviewModel";
import { previewBucketOpsConfigPaste } from "./bucketOpsConfigPastePreview";

function createApi() {
  return {
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
  sources: BulkConfigClipboardBucket[],
): BulkConfigClipboard {
  return {
    version: 1,
    copiedAt: "2026-08-28T14:00:00.000Z",
    sourceEndpointId: 3,
    sourceEndpointName: "Source",
    features,
    buckets: sources,
  };
}

function preview(
  features: BulkCopyFeatureSelection,
  options: {
    api?: ReturnType<typeof createApi>;
    clipboard?: BulkConfigClipboard | null;
    isStorageOps?: boolean;
    sources?: BulkConfigClipboardBucket[];
  } = {},
) {
  const api = options.api ?? createApi();
  const sources = options.sources ?? [createSource()];
  const clipboard = options.clipboard === undefined
    ? createClipboard(features, sources)
    : options.clipboard;
  const mappings = sources.map((source, index) => ({
    sourceBucket: source.name,
    destinationBucket: `destination-${index + 1}`,
    sourceConfig: source,
  }));
  const onProgress = vi.fn();
  const result = previewBucketOpsConfigPaste({
    ...api,
    clipboard,
    isStorageOps: options.isStorageOps ?? false,
    mappings,
    onProgress,
    targetEndpointId: 7,
  });
  return { api, onProgress, result };
}

describe("previewBucketOpsConfigPaste", () => {
  it("builds changed before/after sections for every copied configuration", async () => {
    const { onProgress, result } = preview(allFeatures);

    const items = await result;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ bucket: "destination-1", changed: true });
    expect(
      buildBulkPreviewSections(items[0], "paste_configs").map(({ label, changed }) => ({
        label,
        changed,
      })),
    ).toEqual([
      { label: "Overview", changed: false },
      { label: "Quota", changed: true },
      { label: "Versioning", changed: true },
      { label: "Object Lock", changed: true },
      { label: "Block Public Access", changed: true },
      { label: "Lifecycle", changed: true },
      { label: "CORS", changed: true },
      { label: "Bucket Policy", changed: true },
      { label: "Access logging", changed: true },
    ]);
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 1, total: 1, failed: 0 });
  });

  it("marks every section unchanged when destination values already match", async () => {
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

    const items = await preview(allFeatures, { api }).result;

    expect(items[0].changed).toBe(false);
    expect(
      buildBulkPreviewSections(items[0], "paste_configs").every(
        (section) => !section.changed,
      ),
    ).toBe(true);
  });

  it("keeps a failed destination as an explicit preview error", async () => {
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
    const { onProgress, result } = preview(features, { api, sources });

    await expect(result).resolves.toEqual([
      expect.objectContaining({ bucket: "destination-1", changed: true }),
      {
        bucket: "destination-2",
        before: [{ text: "Source bucket: second" }, { text: "Preview failed." }],
        after: [{ text: "Source bucket: second" }, { text: "Preview failed." }],
        changed: false,
        error: "Unavailable",
      },
    ]);
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 2, total: 2, failed: 1 });
  });

  it("returns an unavailable preview without issuing reads after clipboard loss", async () => {
    const { api, result } = preview(allFeatures, { clipboard: null });

    await expect(result).resolves.toEqual([
      {
        bucket: "destination-1",
        changed: false,
        before: [{ text: "Clipboard unavailable." }],
        after: [{ text: "Clipboard unavailable." }],
      },
    ]);
    expect(api.getBucketProperties).not.toHaveBeenCalled();
    expect(api.fetchBucketQuota).not.toHaveBeenCalled();
  });

  it("does not preview copied quota through Storage Ops", async () => {
    const features = {
      ...DEFAULT_BULK_COPY_FEATURE_SELECTION,
      quota: true,
    };
    const { api, result } = preview(features, { isStorageOps: true });

    const items = await result;
    expect(items[0]).toMatchObject({ changed: false });
    expect(items[0].before).toEqual([{ text: "Source bucket: source" }]);
    expect(api.fetchBucketQuota).not.toHaveBeenCalled();
  });
});

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BulkPreviewItem } from "./bucketBulkOperationsModel";
import { prepareBucketOpsBulkInput } from "./bucketOpsBulkInput";
import { previewBucketOpsBulkUpdate } from "./bucketOpsBulkPreview";
import { previewBucketOpsConfigPaste } from "./bucketOpsConfigPastePreview";
import { useBucketOpsBulkPreview } from "./useBucketOpsBulkPreview";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const previewItem: BulkPreviewItem = {
  bucket: "alpha",
  changed: true,
  before: [{ text: "Disabled" }],
  after: [{ text: "Enabled" }],
};

const prepared = prepareBucketOpsBulkInput({
  operation: "enable_versioning",
  quota: {
    applyObjects: true,
    applySize: true,
    objects: "",
    sizeUnit: "GiB",
    sizeValue: "",
  },
  lifecycle: {
    deleteIds: "",
    deleteTypes: {},
    ruleText: "",
    updateOnlyExisting: false,
  },
  notifications: {
    configurationText: "",
    deleteIds: "",
    deleteTypes: {},
  },
  cors: {
    deleteIds: "",
    deleteTypes: {},
    ruleText: "",
    updateOnlyExisting: false,
  },
  policy: {
    deleteIds: "",
    deleteTypes: {},
    policyText: "",
    updateOnlyExisting: false,
  },
  publicAccessBlockTargets: {},
});

function createOptions() {
  const previewBulkOperation = vi.fn(
    async (input: Parameters<typeof previewBucketOpsBulkUpdate>[0]) => {
      input.onProgress?.({ completed: 1, total: 1, failed: 0 });
      return [previewItem];
    },
  );
  const previewPasteOperation = vi.fn(
    async (input: Parameters<typeof previewBucketOpsConfigPaste>[0]) => {
      input.onProgress?.({ completed: 1, total: 1, failed: 0 });
      return [previewItem];
    },
  );
  return {
    bucketNames: ["alpha"],
    clipboard: null,
    corsUpdateOnlyExisting: false,
    endpointId: 7,
    extractError: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    fetchBucketQuota: vi.fn(async () => ({
      maxSizeBytes: null,
      maxObjects: null,
    })),
    getBucketCors: vi.fn(),
    getBucketLifecycle: vi.fn(),
    getBucketLogging: vi.fn(),
    getBucketNotifications: vi.fn(),
    getBucketPolicy: vi.fn(),
    getBucketProperties: vi.fn(),
    getBucketPublicAccessBlock: vi.fn(),
    isStorageOps: false,
    lifecycleUpdateOnlyExisting: false,
    onPreviewStart: vi.fn(),
    operation: "enable_versioning" as const,
    pastePlan: { mode: null, mappings: [], error: null },
    policyUpdateOnlyExisting: false,
    prepared,
    previewBulkOperation,
    previewPasteOperation,
    quotaDisabledReason: null,
    quotaSkipConfigured: false,
  };
}

describe("useBucketOpsBulkPreview", () => {
  it("runs a prepared bulk preview and owns its progress state", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBucketOpsBulkPreview(options));

    await act(async () => result.current.runBulkPreview());

    expect(options.previewBulkOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketNames: ["alpha"],
        endpointId: 7,
        operation: "enable_versioning",
      }),
    );
    expect(options.previewPasteOperation).not.toHaveBeenCalled();
    expect(options.onPreviewStart).toHaveBeenCalledOnce();
    expect(result.current.bulkPreview).toEqual([previewItem]);
    expect(result.current.bulkPreviewReady).toBe(true);
    expect(result.current.bulkPreviewLoading).toBe(false);
    expect(result.current.bulkPreviewProgress).toBeNull();
  });

  it("routes paste previews through the paste plan", async () => {
    const options = createOptions();
    const sourceConfig = {
      name: "source",
      quota: null,
      versioningEnabled: true,
      objectLock: null,
      publicAccessBlock: null,
      lifecycleRules: null,
      corsRules: null,
      policy: null,
      accessLogging: null,
    };
    const { result } = renderHook(() =>
      useBucketOpsBulkPreview({
        ...options,
        operation: "paste_configs",
        pastePlan: {
          mode: "one_to_one",
          mappings: [
            {
              sourceBucket: "source",
              destinationBucket: "alpha",
              sourceConfig,
            },
          ],
          error: null,
        },
      }),
    );

    await act(async () => result.current.runBulkPreview());

    expect(options.previewPasteOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        mappings: [expect.objectContaining({ destinationBucket: "alpha" })],
        targetEndpointId: 7,
      }),
    );
    expect(options.previewBulkOperation).not.toHaveBeenCalled();
    expect(result.current.bulkPreviewReady).toBe(true);
  });

  it("reports validation failures without starting a preview", async () => {
    const options = createOptions();
    const { result } = renderHook(() =>
      useBucketOpsBulkPreview({
        ...options,
        operation: "set_quota",
        quotaDisabledReason: "bucket stats unavailable",
      }),
    );

    await act(async () => result.current.runBulkPreview());

    expect(result.current.bulkPreviewError).toBe(
      "Set bucket quota is unavailable: bucket stats unavailable.",
    );
    expect(options.previewBulkOperation).not.toHaveBeenCalled();
    expect(options.onPreviewStart).not.toHaveBeenCalled();
  });

  it("surfaces unexpected current-run failures", async () => {
    const options = createOptions();
    options.previewBulkOperation.mockRejectedValueOnce(
      new Error("preview failed"),
    );
    const { result } = renderHook(() => useBucketOpsBulkPreview(options));

    await act(async () => result.current.runBulkPreview());

    expect(result.current.bulkPreviewError).toBe("preview failed");
    expect(result.current.bulkPreviewReady).toBe(false);
    expect(result.current.bulkPreviewLoading).toBe(false);
  });

  it("ignores a preview completed after its endpoint changes", async () => {
    const options = createOptions();
    const deferred = createDeferred<BulkPreviewItem[]>();
    options.previewBulkOperation.mockReturnValueOnce(deferred.promise);
    const { result, rerender } = renderHook(
      ({ endpointId }) => useBucketOpsBulkPreview({ ...options, endpointId }),
      { initialProps: { endpointId: 7 } },
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.runBulkPreview();
    });
    rerender({ endpointId: 8 });
    await act(async () => {
      deferred.resolve([previewItem]);
      await pending;
    });

    expect(result.current.bulkPreview).toEqual([]);
    expect(result.current.bulkPreviewReady).toBe(false);
    expect(result.current.bulkPreviewLoading).toBe(false);
  });
});

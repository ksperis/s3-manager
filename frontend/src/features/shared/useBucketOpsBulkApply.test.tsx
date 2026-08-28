/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applyBucketOpsBulkUpdate } from "./bucketOpsBulkApply";
import { prepareBucketOpsBulkInput } from "./bucketOpsBulkInput";
import { applyBucketOpsConfigPaste } from "./bucketOpsConfigPaste";
import { useBucketOpsBulkApply } from "./useBucketOpsBulkApply";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

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

const successResult = {
  changedCount: 1,
  unchangedCount: 0,
  failedCount: 0,
  error: null,
  summary: "Updated 1 bucket.",
};

function createOptions() {
  const applyBulkOperation = vi.fn(
    async (input: Parameters<typeof applyBucketOpsBulkUpdate>[0]) => {
      input.onProgress?.({ completed: 1, total: 1, failed: 0 });
      return successResult;
    },
  );
  const applyPasteOperation = vi.fn(
    async (input: Parameters<typeof applyBucketOpsConfigPaste>[0]) => {
      input.onProgress?.({ completed: 1, total: 1, failed: 0 });
      return successResult;
    },
  );
  return {
    applyBulkOperation,
    applyPasteOperation,
    bucketNames: ["alpha"],
    clipboard: null,
    corsUpdateOnlyExisting: false,
    deleteBucketCors: vi.fn(),
    deleteBucketLifecycle: vi.fn(),
    deleteBucketLogging: vi.fn(),
    deleteBucketNotifications: vi.fn(),
    deleteBucketPolicy: vi.fn(),
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
    operation: "enable_versioning" as const,
    pastePlan: { mode: null, mappings: [], error: null },
    policyUpdateOnlyExisting: false,
    prepared,
    putBucketCors: vi.fn(),
    putBucketLifecycle: vi.fn(),
    putBucketLogging: vi.fn(),
    putBucketNotifications: vi.fn(),
    putBucketPolicy: vi.fn(),
    quotaDisabledReason: null,
    quotaSkipConfigured: false,
    refreshBuckets: vi.fn(),
    setBucketVersioning: vi.fn(),
    updateBucketObjectLock: vi.fn(),
    updateBucketPublicAccessBlock: vi.fn(),
    updateBucketQuota: vi.fn(),
  };
}

describe("useBucketOpsBulkApply", () => {
  it("runs a prepared bulk update and reconciles the listing", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBucketOpsBulkApply(options));

    await act(async () => result.current.applyBulkUpdate());

    expect(options.applyBulkOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketNames: ["alpha"],
        endpointId: 7,
        operation: "enable_versioning",
      }),
    );
    expect(options.applyPasteOperation).not.toHaveBeenCalled();
    expect(result.current.bulkApplySummary).toBe("Updated 1 bucket.");
    expect(result.current.bulkApplyError).toBeNull();
    expect(result.current.bulkApplyLoading).toBe(false);
    expect(result.current.bulkApplyProgress).toBeNull();
    expect(options.refreshBuckets).toHaveBeenCalledOnce();
  });

  it("routes paste updates and preserves partial-failure summaries", async () => {
    const options = createOptions();
    const partialResult = {
      changedCount: 1,
      unchangedCount: 0,
      failedCount: 1,
      error: "1 bucket(s) failed to update.",
      summary: "Updated 1 bucket.",
    };
    options.applyPasteOperation.mockResolvedValueOnce(partialResult);
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
      useBucketOpsBulkApply({
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

    await act(async () => result.current.applyBulkUpdate());

    expect(options.applyPasteOperation).toHaveBeenCalledOnce();
    expect(result.current.bulkApplyError).toBe(
      "1 bucket(s) failed to update.",
    );
    expect(result.current.bulkApplySummary).toBe("Updated 1 bucket.");
    expect(options.refreshBuckets).toHaveBeenCalledOnce();
  });

  it("surfaces unexpected failures, releases loading, and reconciles", async () => {
    const options = createOptions();
    options.applyBulkOperation.mockRejectedValueOnce(new Error("apply failed"));
    const { result } = renderHook(() => useBucketOpsBulkApply(options));

    await act(async () => result.current.applyBulkUpdate());

    expect(result.current.bulkApplyError).toBe("apply failed");
    expect(result.current.bulkApplyLoading).toBe(false);
    expect(result.current.bulkApplyProgress).toBeNull();
    expect(options.refreshBuckets).toHaveBeenCalledOnce();
  });

  it("keeps the mutation lock while feedback is reset", async () => {
    const options = createOptions();
    const deferred = createDeferred<
      Awaited<ReturnType<typeof applyBucketOpsBulkUpdate>>
    >();
    options.applyBulkOperation.mockReturnValueOnce(deferred.promise);
    const { result } = renderHook(() => useBucketOpsBulkApply(options));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.applyBulkUpdate();
    });
    act(() => result.current.resetBulkApply());
    await act(async () => result.current.applyBulkUpdate());

    expect(result.current.bulkApplyLoading).toBe(true);
    expect(options.applyBulkOperation).toHaveBeenCalledOnce();

    await act(async () => {
      deferred.resolve(successResult);
      await pending;
    });

    expect(result.current.bulkApplyLoading).toBe(false);
    expect(result.current.bulkApplySummary).toBeNull();
    expect(options.refreshBuckets).not.toHaveBeenCalled();
  });

  it("ignores an application result completed after its endpoint changes", async () => {
    const options = createOptions();
    const deferred = createDeferred<
      Awaited<ReturnType<typeof applyBucketOpsBulkUpdate>>
    >();
    options.applyBulkOperation.mockReturnValueOnce(deferred.promise);
    const { result, rerender } = renderHook(
      ({ endpointId }) => useBucketOpsBulkApply({ ...options, endpointId }),
      { initialProps: { endpointId: 7 } },
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.applyBulkUpdate();
    });
    rerender({ endpointId: 8 });

    expect(result.current.bulkApplyLoading).toBe(true);

    await act(async () => {
      deferred.resolve(successResult);
      await pending;
    });

    expect(result.current.bulkApplyLoading).toBe(false);
    expect(result.current.bulkApplySummary).toBeNull();
    expect(options.refreshBuckets).not.toHaveBeenCalled();
  });
});

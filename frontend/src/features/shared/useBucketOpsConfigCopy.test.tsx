/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BULK_COPY_FEATURE_SELECTION,
  type BulkConfigClipboard,
} from "./bucketBulkOperationsModel";
import { copyBucketOpsConfigs } from "./bucketOpsConfigCopy";
import { useBucketOpsConfigCopy } from "./useBucketOpsConfigCopy";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const clipboard: BulkConfigClipboard = {
  version: 1,
  copiedAt: "2026-08-28T01:00:00.000Z",
  sourceEndpointId: 7,
  sourceEndpointName: "Primary",
  features: { ...DEFAULT_BULK_COPY_FEATURE_SELECTION },
  buckets: [
    {
      name: "alpha",
      quota: null,
      versioningEnabled: true,
      objectLock: null,
      publicAccessBlock: null,
      lifecycleRules: null,
      corsRules: null,
      policy: null,
      accessLogging: null,
    },
  ],
};

function createOptions() {
  const copyOperation = vi.fn(
    async (_input: Parameters<typeof copyBucketOpsConfigs>[0]) => ({
      kind: "success" as const,
      clipboard,
      summary: "Copied one bucket.",
    }),
  );
  return {
    bucketNames: ["alpha"],
    copyOperation,
    extractError: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    features: { ...DEFAULT_BULK_COPY_FEATURE_SELECTION },
    getBucketCors: vi.fn(async () => ({ rules: [] })),
    getBucketLifecycle: vi.fn(async () => ({ rules: [] })),
    getBucketLogging: vi.fn(async () => ({ enabled: false })),
    getBucketPolicy: vi.fn(async () => ({ policy: null })),
    getBucketProperties: vi.fn(async () => ({})),
    getBucketPublicAccessBlock: vi.fn(async () => ({})),
    isStorageOps: false,
    listBuckets: vi.fn(async () => ({ items: [] })),
    loadClipboard: vi.fn(() => null),
    now: () => new Date("2026-08-28T01:00:00.000Z"),
    persistClipboard: vi.fn(),
    sourceEndpointId: 7,
    sourceEndpointName: "Primary",
    storageKey: "bucket-ops.copy.primary",
    usageFeatureEnabled: true,
  };
}

describe("useBucketOpsConfigCopy", () => {
  it("owns copy progress, result state, and clipboard persistence", async () => {
    const options = createOptions();
    options.copyOperation.mockImplementationOnce(async (input) => {
      input.onProgress?.({ completed: 1, total: 1, failed: 0 });
      return {
        kind: "success",
        clipboard,
        summary: "Copied one bucket.",
      };
    });
    const { result } = renderHook(() => useBucketOpsConfigCopy(options));

    await act(async () => result.current.copyBulkConfigs());

    expect(options.copyOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketNames: ["alpha"],
        copiedAt: "2026-08-28T01:00:00.000Z",
        sourceEndpointId: 7,
        sourceEndpointName: "Primary",
      }),
    );
    expect(result.current.bulkConfigClipboard).toEqual(clipboard);
    expect(result.current.bulkCopySummary).toBe("Copied one bucket.");
    expect(result.current.bulkCopyError).toBeNull();
    expect(result.current.bulkCopyLoading).toBe(false);
    expect(result.current.bulkCopyProgress).toBeNull();
    expect(options.persistClipboard).toHaveBeenCalledWith(
      "bucket-ops.copy.primary",
      clipboard,
    );
  });

  it("surfaces current-run failures and resets feedback", async () => {
    const options = createOptions();
    options.copyOperation.mockRejectedValueOnce(new Error("copy failed"));
    const { result } = renderHook(() => useBucketOpsConfigCopy(options));

    await act(async () => result.current.copyBulkConfigs());

    expect(result.current.bulkCopyError).toBe("copy failed");
    expect(result.current.bulkCopyLoading).toBe(false);

    act(() => result.current.resetBulkCopy());

    expect(result.current.bulkCopyError).toBeNull();
    expect(result.current.bulkCopySummary).toBeNull();
  });

  it("ignores a copy result completed after explicit cancellation", async () => {
    const options = createOptions();
    const deferred = createDeferred<
      Awaited<ReturnType<typeof copyBucketOpsConfigs>>
    >();
    options.copyOperation.mockReturnValueOnce(deferred.promise);
    const { result } = renderHook(() => useBucketOpsConfigCopy(options));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.copyBulkConfigs();
    });
    act(() => result.current.cancelBulkCopy());
    await act(async () => {
      deferred.resolve({
        kind: "success",
        clipboard,
        summary: "Too late",
      });
      await pending;
    });

    expect(result.current.bulkConfigClipboard).toBeNull();
    expect(result.current.bulkCopySummary).toBeNull();
    expect(result.current.bulkCopyLoading).toBe(false);
  });

  it("cancels an in-flight copy when its endpoint scope changes", async () => {
    const options = createOptions();
    const deferred = createDeferred<
      Awaited<ReturnType<typeof copyBucketOpsConfigs>>
    >();
    options.copyOperation.mockReturnValueOnce(deferred.promise);
    const { result, rerender } = renderHook(
      ({ sourceEndpointId }) =>
        useBucketOpsConfigCopy({ ...options, sourceEndpointId }),
      { initialProps: { sourceEndpointId: 7 } },
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.copyBulkConfigs();
    });
    rerender({ sourceEndpointId: 8 });
    await act(async () => {
      deferred.resolve({
        kind: "success",
        clipboard,
        summary: "Wrong endpoint",
      });
      await pending;
    });

    expect(result.current.bulkConfigClipboard).toBeNull();
    expect(result.current.bulkCopySummary).toBeNull();
    expect(options.persistClipboard).not.toHaveBeenCalledWith(
      "bucket-ops.copy.primary",
      clipboard,
    );
  });

  it("loads a new clipboard without persisting the previous scope into it", () => {
    const options = createOptions();
    options.loadClipboard.mockImplementation((storageKey) =>
      storageKey === "bucket-ops.copy.secondary" ? clipboard : null,
    );
    const { result, rerender } = renderHook(
      ({ storageKey }) => useBucketOpsConfigCopy({ ...options, storageKey }),
      { initialProps: { storageKey: "bucket-ops.copy.primary" } },
    );

    rerender({ storageKey: "bucket-ops.copy.secondary" });

    expect(result.current.bulkConfigClipboard).toEqual(clipboard);
    expect(options.persistClipboard).toHaveBeenCalledWith(
      "bucket-ops.copy.secondary",
      clipboard,
    );
    expect(options.persistClipboard).not.toHaveBeenCalledWith(
      "bucket-ops.copy.secondary",
      null,
    );
  });
});

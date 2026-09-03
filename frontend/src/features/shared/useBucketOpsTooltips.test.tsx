/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BucketProperties } from "../../api/bucketContracts";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import { useBucketOpsTooltips } from "./useBucketOpsTooltips";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function createApi() {
  return {
    getBucketEncryption: vi.fn(async () => ({ rules: [] })),
    getBucketLogging: vi.fn(async () => ({ enabled: false })),
    getBucketNotifications: vi.fn(async () => ({ configuration: {} })),
    getBucketPolicy: vi.fn(async () => ({ policy: null })),
    getBucketProperties: vi.fn(async (): Promise<BucketProperties> => ({
      lifecycle_rules: [],
      object_lock_enabled: true,
      object_lock: { enabled: true, mode: "GOVERNANCE", days: 7 },
      versioning_status: "Enabled",
    })),
    getBucketWebsite: vi.fn(async () => ({})),
    listBuckets: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      page_size: 5,
      has_next: false,
      stats_available: true,
    })),
  };
}

const bucket: CephAdminBucket = {
  name: "reports",
  owner: "owner-a",
  tenant: "tenant-a",
};

describe("useBucketOpsTooltips", () => {
  it("coalesces owner lookups and caches the resolved display name", async () => {
    const api = createApi();
    api.listBuckets.mockResolvedValue({
      items: [{ ...bucket, owner_name: "Platform team" }],
      total: 1,
      page: 1,
      page_size: 5,
      has_next: false,
      stats_available: true,
    });
    const { result } = renderHook(() =>
      useBucketOpsTooltips({
        ...api,
        extractError: (error) => String(error),
        missingScopeError: "Select an endpoint",
        selectedScopeId: 7,
      }),
    );

    act(() => {
      result.current.loadOwnerTooltip(bucket);
      result.current.loadOwnerTooltip(bucket);
    });

    const key = result.current.ownerTooltipCacheKey(bucket);
    await waitFor(() =>
      expect(result.current.ownerTooltipState[key]).toEqual({
        status: "ready",
        ownerName: "Platform team",
      }),
    );
    expect(key).toBe("7:tenant-a:reports:owner-a:owner");
    expect(api.listBuckets).toHaveBeenCalledOnce();
    expect(api.listBuckets).toHaveBeenCalledWith(7, {
      page: 1,
      page_size: 5,
      advanced_filter: JSON.stringify({
        match: "all",
        rules: [
          { field: "name", op: "eq", value: "reports" },
          { field: "tenant", op: "eq", value: "tenant-a" },
          { field: "owner", op: "eq", value: "owner-a" },
        ],
      }),
      include: ["owner_name"],
      with_stats: false,
    });
  });

  it("shares bucket properties across feature summaries", async () => {
    const api = createApi();
    const { result } = renderHook(() =>
      useBucketOpsTooltips({
        ...api,
        extractError: (error) => String(error),
        missingScopeError: "Select an endpoint",
        selectedScopeId: 7,
      }),
    );

    act(() => result.current.loadFeatureTooltip(bucket, "versioning"));
    const versioningKey = result.current.featureTooltipCacheKey(bucket, "versioning");
    await waitFor(() =>
      expect(result.current.featureTooltipState[versioningKey]).toEqual({
        status: "ready",
        lines: ["Versioning: Enabled"],
      }),
    );

    act(() => result.current.loadFeatureTooltip(bucket, "object_lock"));
    const objectLockKey = result.current.featureTooltipCacheKey(bucket, "object_lock");
    await waitFor(() =>
      expect(result.current.featureTooltipState[objectLockKey]).toEqual({
        status: "ready",
        lines: ["Enabled: Yes", "Mode: GOVERNANCE", "Default retention: 7 day(s)"],
      }),
    );
    expect(api.getBucketProperties).toHaveBeenCalledOnce();
    expect(api.getBucketProperties).toHaveBeenCalledWith(7, "reports");
  });

  it("ignores stale work after a cache reset without disrupting the replacement request", async () => {
    const api = createApi();
    const stale = createDeferred<BucketProperties>();
    const current = createDeferred<BucketProperties>();
    api.getBucketProperties
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const { result } = renderHook(() =>
      useBucketOpsTooltips({
        ...api,
        extractError: (error) => String(error),
        missingScopeError: "Select an endpoint",
        selectedScopeId: 7,
      }),
    );
    const key = result.current.featureTooltipCacheKey(bucket, "versioning");

    act(() => result.current.loadFeatureTooltip(bucket, "versioning"));
    await waitFor(() =>
      expect(result.current.featureTooltipState[key]).toEqual({ status: "loading" }),
    );

    act(() => result.current.resetBucketTooltipState());
    await waitFor(() => expect(result.current.featureTooltipState[key]).toBeUndefined());
    act(() => result.current.loadFeatureTooltip(bucket, "versioning"));
    await waitFor(() => {
      expect(api.getBucketProperties).toHaveBeenCalledTimes(2);
      expect(result.current.featureTooltipState[key]).toEqual({ status: "loading" });
    });

    await act(async () => {
      stale.resolve({ lifecycle_rules: [], versioning_status: "Enabled" });
      await stale.promise;
    });
    expect(result.current.featureTooltipState[key]).toEqual({ status: "loading" });

    await act(async () => {
      current.resolve({ lifecycle_rules: [], versioning_status: "Suspended" });
      await current.promise;
    });
    expect(result.current.featureTooltipState[key]).toEqual({
      status: "ready",
      lines: ["Versioning: Suspended"],
    });
  });
});

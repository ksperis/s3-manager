import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketUsageStatsController } from "../useBucketUsageStatsController";

const apiMocks = vi.hoisted(() => ({
  getCephAdminBucketUsageStats: vi.fn(),
  getManagerBucketUsageStats: vi.fn(),
  streamCephAdminBucketUsageStatsForBucket: vi.fn(),
  streamManagerBucketUsageStatsForBucket: vi.fn(),
}));

vi.mock("../../../../api/bucketUsageStats", () => ({
  getCephAdminBucketUsageStats: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketUsageStats(...args),
  getManagerBucketUsageStats: (...args: unknown[]) =>
    apiMocks.getManagerBucketUsageStats(...args),
  streamCephAdminBucketUsageStatsForBucket: (...args: unknown[]) =>
    apiMocks.streamCephAdminBucketUsageStatsForBucket(...args),
  streamManagerBucketUsageStatsForBucket: (...args: unknown[]) =>
    apiMocks.streamManagerBucketUsageStatsForBucket(...args),
}));

function renderUsageStats(
  overrides: Partial<Parameters<typeof useBucketUsageStatsController>[0]> = {},
) {
  return renderHook(() =>
    useBucketUsageStatsController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketUsageStatsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and recalculates Manager usage stats", async () => {
    const initialSnapshot = { used_bytes: 10 };
    const refreshedSnapshot = { used_bytes: 20 };
    apiMocks.getManagerBucketUsageStats
      .mockResolvedValueOnce({ snapshot: initialSnapshot })
      .mockResolvedValueOnce({ snapshot: refreshedSnapshot });
    apiMocks.streamManagerBucketUsageStatsForBucket.mockResolvedValue(undefined);
    const { result } = renderUsageStats();

    await act(async () => result.current.load());
    expect(apiMocks.getManagerBucketUsageStats).toHaveBeenCalledWith(
      "acc-1",
      "reports",
    );
    expect(result.current.snapshot).toEqual(initialSnapshot);

    await act(async () => result.current.recalculate());

    expect(
      apiMocks.streamManagerBucketUsageStatsForBucket,
    ).toHaveBeenCalledWith("acc-1", "reports");
    expect(apiMocks.getManagerBucketUsageStats).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot).toEqual(refreshedSnapshot);
    expect(result.current.error).toBeNull();
    expect(result.current.recalculating).toBe(false);
  });

  it("uses the selected Ceph Admin endpoint", async () => {
    const snapshot = { object_count: 42 };
    apiMocks.getCephAdminBucketUsageStats.mockResolvedValue({ snapshot });
    apiMocks.streamCephAdminBucketUsageStatsForBucket.mockResolvedValue(
      undefined,
    );
    const { result } = renderUsageStats({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    await act(async () => result.current.recalculate());

    expect(apiMocks.getCephAdminBucketUsageStats).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(
      apiMocks.streamCephAdminBucketUsageStatsForBucket,
    ).toHaveBeenCalledWith(7, "reports");
    expect(result.current.snapshot).toEqual(snapshot);
  });

  it("reports load and recalculation failures", async () => {
    apiMocks.getManagerBucketUsageStats.mockRejectedValueOnce(
      new Error("stats unavailable"),
    );
    const { result } = renderUsageStats();

    await act(async () => result.current.load());
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBe("stats unavailable");

    apiMocks.streamManagerBucketUsageStatsForBucket.mockRejectedValueOnce(
      new Error("calculation failed"),
    );
    await act(async () => result.current.recalculate());

    expect(result.current.error).toBe("calculation failed");
    expect(result.current.recalculating).toBe(false);
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const disabled = renderUsageStats({ enabled: false });
    const missingEndpoint = renderUsageStats({
      cephAdmin: true,
      endpointId: null,
    });

    await act(async () => disabled.result.current.load());
    await act(async () => disabled.result.current.recalculate());
    await act(async () => missingEndpoint.result.current.load());
    await act(async () => missingEndpoint.result.current.recalculate());

    expect(apiMocks.getManagerBucketUsageStats).not.toHaveBeenCalled();
    expect(
      apiMocks.streamManagerBucketUsageStatsForBucket,
    ).not.toHaveBeenCalled();
    expect(apiMocks.getCephAdminBucketUsageStats).not.toHaveBeenCalled();
    expect(
      apiMocks.streamCephAdminBucketUsageStatsForBucket,
    ).not.toHaveBeenCalled();
  });
});

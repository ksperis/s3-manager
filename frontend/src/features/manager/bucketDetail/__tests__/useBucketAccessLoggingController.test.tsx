import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketAccessLoggingController } from "../useBucketAccessLoggingController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketLogging: vi.fn(),
  deleteCephAdminBucketLogging: vi.fn(),
  getBucketLogging: vi.fn(),
  getCephAdminBucketLogging: vi.fn(),
  putBucketLogging: vi.fn(),
  putCephAdminBucketLogging: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  deleteBucketLogging: (...args: unknown[]) =>
    apiMocks.deleteBucketLogging(...args),
  getBucketLogging: (...args: unknown[]) => apiMocks.getBucketLogging(...args),
  putBucketLogging: (...args: unknown[]) => apiMocks.putBucketLogging(...args),
}));

vi.mock("../../../../api/cephAdmin", () => ({
  deleteCephAdminBucketLogging: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketLogging(...args),
  getCephAdminBucketLogging: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketLogging(...args),
  putCephAdminBucketLogging: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketLogging(...args),
}));

function renderAccessLogging(
  overrides: Partial<Parameters<typeof useBucketAccessLoggingController>[0]> = {},
) {
  return renderHook(() =>
    useBucketAccessLoggingController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketAccessLoggingController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, edits, and saves Manager access logging", async () => {
    apiMocks.getBucketLogging.mockResolvedValue({
      enabled: true,
      target_bucket: "logs-old",
      target_prefix: "archive/",
    });
    apiMocks.putBucketLogging.mockImplementation(
      async (_accountId: string, _bucketName: string, payload: unknown) => payload,
    );
    const { result } = renderAccessLogging();

    await act(async () => result.current.load());
    expect(apiMocks.getBucketLogging).toHaveBeenCalledWith("acc-1", "reports");
    expect(result.current.configured).toBe(true);
    expect(result.current.dirty).toBe(false);

    act(() => {
      result.current.updateTargetBucket(" logs-new ");
      result.current.updateTargetPrefix(" daily/ ");
    });
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());

    expect(apiMocks.putBucketLogging).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      {
        enabled: true,
        target_bucket: "logs-new",
        target_prefix: "daily/",
      },
    );
    expect(result.current.status).toBe("Access logging updated.");
    expect(result.current.dirty).toBe(false);
  });

  it("requires a target bucket and clears feedback on edit", async () => {
    const { result } = renderAccessLogging();

    act(() => result.current.updateEnabled(true));
    await act(async () => result.current.save());
    expect(result.current.error).toBe(
      "Target bucket is required to enable access logging.",
    );
    expect(apiMocks.putBucketLogging).not.toHaveBeenCalled();

    act(() => result.current.updateTargetBucket("logs"));
    expect(result.current.error).toBeNull();
  });

  it("uses the Ceph Admin endpoint when disabling access logging", async () => {
    apiMocks.getCephAdminBucketLogging.mockResolvedValue({
      enabled: true,
      target_bucket: "logs",
      target_prefix: null,
    });
    apiMocks.deleteCephAdminBucketLogging.mockResolvedValue(undefined);
    const { result } = renderAccessLogging({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    await act(async () => result.current.clear());

    expect(apiMocks.deleteCephAdminBucketLogging).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(result.current.configured).toBe(false);
    expect(result.current.status).toBe("Access logging disabled.");
  });

  it("does not access logging APIs without a bucket context", async () => {
    const { result } = renderAccessLogging({ enabled: false });

    await act(async () => result.current.load());
    await act(async () => result.current.save());
    await act(async () => result.current.clear());

    expect(apiMocks.getBucketLogging).not.toHaveBeenCalled();
    expect(apiMocks.putBucketLogging).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketLogging).not.toHaveBeenCalled();
  });
});

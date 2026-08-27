import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketMetadataController } from "../useBucketMetadataController";

const apiMocks = vi.hoisted(() => ({
  getBucketStats: vi.fn(),
  listCephAdminBuckets: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  getBucketStats: (...args: unknown[]) => apiMocks.getBucketStats(...args),
}));

vi.mock("../../../../api/cephAdmin", () => ({
  listCephAdminBuckets: (...args: unknown[]) =>
    apiMocks.listCephAdminBuckets(...args),
}));

function renderMetadata(
  overrides: Partial<Parameters<typeof useBucketMetadataController>[0]> = {},
) {
  return renderHook(() =>
    useBucketMetadataController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      withStats: true,
      ...overrides,
    }),
  );
}

describe("useBucketMetadataController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads one Manager bucket through the dedicated stats endpoint", async () => {
    apiMocks.getBucketStats.mockResolvedValue({
      name: "reports",
      object_count: 12,
      used_bytes: 4096,
    });
    const { result } = renderMetadata();

    await act(async () => result.current.refresh());

    expect(apiMocks.getBucketStats).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      { with_stats: true },
    );
    expect(result.current.bucket).toMatchObject({
      name: "reports",
      object_count: 12,
      used_bytes: 4096,
    });
    expect(result.current.error).toBeNull();
  });

  it("loads and normalizes Ceph Admin bucket metadata", async () => {
    apiMocks.listCephAdminBuckets.mockResolvedValue({
      items: [
        {
          name: "reports",
          object_count: null,
          used_bytes: null,
        },
      ],
    });
    const { result } = renderMetadata({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.refresh());

    expect(apiMocks.listCephAdminBuckets).toHaveBeenCalledWith(7, {
      filter: "reports",
      page: 1,
      page_size: 50,
      with_stats: true,
    });
    expect(result.current.bucket).toEqual({
      name: "reports",
      object_count: undefined,
      used_bytes: undefined,
    });
  });

  it("reports failures without discarding current same-context metadata", async () => {
    apiMocks.getBucketStats
      .mockResolvedValueOnce({ name: "reports", object_count: 12 })
      .mockRejectedValueOnce(new Error("metadata failed"));
    const { result } = renderMetadata();

    await act(async () => result.current.refresh());
    await act(async () => result.current.refresh());

    expect(result.current.bucket).toEqual({
      name: "reports",
      object_count: 12,
    });
    expect(result.current.error).toBe("metadata failed");
  });

  it("ignores metadata returned for a previous account context", async () => {
    let resolveOldBucket!: (value: { name: string }) => void;
    const oldBucket = new Promise<{ name: string }>((resolve) => {
      resolveOldBucket = resolve;
    });
    apiMocks.getBucketStats
      .mockReturnValueOnce(oldBucket)
      .mockResolvedValueOnce({ name: "new-bucket" });
    const initial = { accountId: "acc-1", bucketName: "old-bucket" };
    const { result, rerender } = renderHook(
      (props: typeof initial) =>
        useBucketMetadataController({
          ...props,
          cephAdmin: false,
          enabled: true,
          endpointId: null,
          withStats: true,
        }),
      { initialProps: initial },
    );

    let pendingOldLoad!: Promise<void>;
    act(() => {
      pendingOldLoad = result.current.refresh();
    });
    rerender({ accountId: "acc-2", bucketName: "new-bucket" });
    await act(async () => result.current.refresh());

    await act(async () => {
      resolveOldBucket({ name: "old-bucket" });
      await pendingOldLoad;
    });

    expect(result.current.bucket).toEqual({ name: "new-bucket" });
    expect(result.current.loading).toBe(false);
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const disabled = renderMetadata({ enabled: false });
    const missingEndpoint = renderMetadata({
      cephAdmin: true,
      endpointId: null,
    });

    await act(async () => disabled.result.current.refresh());
    await act(async () => missingEndpoint.result.current.refresh());

    expect(apiMocks.getBucketStats).not.toHaveBeenCalled();
    expect(apiMocks.listCephAdminBuckets).not.toHaveBeenCalled();
    expect(disabled.result.current.bucket).toBeNull();
    expect(missingEndpoint.result.current.bucket).toBeNull();
  });
});

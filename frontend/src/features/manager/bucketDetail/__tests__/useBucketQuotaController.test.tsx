import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketQuotaController } from "../useBucketQuotaController";

const apiMocks = vi.hoisted(() => ({
  updateBucketQuota: vi.fn(),
  updateCephAdminBucketQuota: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  updateBucketQuota: (...args: unknown[]) =>
    apiMocks.updateBucketQuota(...args),
}));

vi.mock("../../../../api/cephAdmin", () => ({
  updateCephAdminBucketQuota: (...args: unknown[]) =>
    apiMocks.updateCephAdminBucketQuota(...args),
}));

function renderQuota(
  overrides: Partial<Parameters<typeof useBucketQuotaController>[0]> = {},
) {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const rendered = renderHook(() =>
    useBucketQuotaController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      editable: true,
      enabled: true,
      endpointId: null,
      maxObjects: 1_000,
      maxSizeBytes: 2 * 1024 ** 3,
      onSaved,
      ...overrides,
    }),
  );
  return { ...rendered, onSaved };
}

describe("useBucketQuotaController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("synchronizes and saves a Manager quota without requiring an account selector", async () => {
    apiMocks.updateBucketQuota.mockResolvedValue(undefined);
    const { onSaved, result } = renderQuota({ accountId: null });

    expect(result.current.maxSize).toBe("2");
    expect(result.current.unit).toBe("GiB");
    expect(result.current.maxObjects).toBe("1000");
    expect(result.current.configured).toBe(true);
    expect(result.current.dirty).toBe(false);

    await act(async () => result.current.save());
    expect(apiMocks.updateBucketQuota).not.toHaveBeenCalled();

    act(() => {
      result.current.updateMaxSize(" 3.5 ");
      result.current.updateMaxObjects("2000");
      result.current.updateUnit("TiB");
    });
    expect(result.current.dirty).toBe(true);

    await act(async () => result.current.save());

    expect(apiMocks.updateBucketQuota).toHaveBeenCalledWith(null, "reports", {
      max_objects: 2000,
      max_size_gb: 3.5,
      max_size_unit: "TiB",
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("Quota updated");
    expect(result.current.dirty).toBe(false);
  });

  it("clears a quota through the Ceph Admin endpoint", async () => {
    apiMocks.updateCephAdminBucketQuota.mockResolvedValue(undefined);
    const { result } = renderQuota({ cephAdmin: true, endpointId: 7 });
    act(() => {
      result.current.updateMaxSize("");
      result.current.updateMaxObjects("");
    });

    await act(async () => result.current.save());

    expect(apiMocks.updateCephAdminBucketQuota).toHaveBeenCalledWith(
      7,
      "reports",
      {
        max_objects: undefined,
        max_size_gb: undefined,
        max_size_unit: undefined,
      },
    );
    expect(result.current.configured).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it("rejects non-finite sizes and fractional object counts", async () => {
    const { result } = renderQuota();
    act(() => {
      result.current.updateMaxSize("Infinity");
      result.current.updateMaxObjects("1.5");
    });

    await act(async () => result.current.save());

    expect(result.current.error).toBe("Invalid quota values.");
    expect(apiMocks.updateBucketQuota).not.toHaveBeenCalled();
  });

  it("resynchronizes the draft when the bucket context changes", () => {
    const initial = {
      accountId: "acc-1",
      bucketName: "reports",
      maxObjects: 1_000,
      maxSizeBytes: 2 * 1024 ** 3,
    };
    const { result, rerender } = renderHook(
      (props: typeof initial) =>
        useBucketQuotaController({
          ...props,
          cephAdmin: false,
          editable: true,
          enabled: true,
          endpointId: null,
          onSaved: vi.fn(),
        }),
      { initialProps: initial },
    );
    act(() => result.current.updateMaxSize("99"));

    rerender({
      accountId: "acc-2",
      bucketName: "reports",
      maxObjects: 24,
      maxSizeBytes: 512 * 1024 ** 2,
    });

    expect(result.current.maxSize).toBe("0.5");
    expect(result.current.maxObjects).toBe("24");
    expect(result.current.dirty).toBe(false);
  });

  it("does not write without an enabled and editable bucket context", async () => {
    const disabled = renderQuota({ enabled: false });
    const restricted = renderQuota({ editable: false });
    const missingEndpoint = renderQuota({ cephAdmin: true, endpointId: null });

    await act(async () => disabled.result.current.save());
    await act(async () => restricted.result.current.save());
    await act(async () => missingEndpoint.result.current.save());

    expect(apiMocks.updateBucketQuota).not.toHaveBeenCalled();
    expect(apiMocks.updateCephAdminBucketQuota).not.toHaveBeenCalled();
  });
});

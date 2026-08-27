import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketVersioningController } from "../useBucketVersioningController";

const apiMocks = vi.hoisted(() => ({
  getBucketVersioning: vi.fn(),
  getCephAdminBucketVersioning: vi.fn(),
  setBucketVersioning: vi.fn(),
  setCephAdminBucketVersioning: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  getBucketVersioning: (...args: unknown[]) =>
    apiMocks.getBucketVersioning(...args),
  setBucketVersioning: (...args: unknown[]) =>
    apiMocks.setBucketVersioning(...args),
}));

vi.mock("../../../../api/cephAdmin", () => ({
  getCephAdminBucketVersioning: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketVersioning(...args),
  setCephAdminBucketVersioning: (...args: unknown[]) =>
    apiMocks.setCephAdminBucketVersioning(...args),
}));

function renderVersioning(
  overrides: Partial<Parameters<typeof useBucketVersioningController>[0]> = {},
) {
  return renderHook(() =>
    useBucketVersioningController({
      accountId: "acc-1",
      bucketName: "records",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketVersioningController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and suspends Manager versioning without a redundant reload", async () => {
    apiMocks.getBucketVersioning.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    apiMocks.setBucketVersioning.mockResolvedValue(undefined);
    const { result } = renderVersioning();

    await act(async () => result.current.load());
    expect(result.current.isEnabled).toBe(true);
    expect(result.current.draftEnabled).toBe(true);
    expect(result.current.dirty).toBe(false);

    act(() => result.current.updateDraft(false));
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save(false));

    expect(apiMocks.setBucketVersioning).toHaveBeenCalledWith(
      "acc-1",
      "records",
      false,
    );
    expect(apiMocks.getBucketVersioning).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("Suspended");
    expect(result.current.isSuspended).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it("refuses to suspend versioning while Object Lock blocks it", async () => {
    apiMocks.getBucketVersioning.mockResolvedValue({ status: "Enabled" });
    const { result } = renderVersioning();
    await act(async () => result.current.load());
    act(() => result.current.updateDraft(false));

    await act(async () => result.current.save(true));

    expect(result.current.saveError).toBe(
      "Versioning cannot be disabled while Object Lock is enabled.",
    );
    expect(apiMocks.setBucketVersioning).not.toHaveBeenCalled();
  });

  it("uses the Ceph Admin endpoint to enable suspended versioning", async () => {
    apiMocks.getCephAdminBucketVersioning.mockResolvedValue({
      enabled: false,
      status: "Suspended",
    });
    apiMocks.setCephAdminBucketVersioning.mockResolvedValue(undefined);
    const { result } = renderVersioning({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    act(() => result.current.updateDraft(true));
    await act(async () => result.current.save(false));

    expect(apiMocks.setCephAdminBucketVersioning).toHaveBeenCalledWith(
      7,
      "records",
      true,
    );
    expect(result.current.isEnabled).toBe(true);
  });

  it("accepts the versioning activation performed by Object Lock", () => {
    const { result } = renderVersioning();
    act(() => result.current.markEnabled());

    expect(result.current.status).toBe("Enabled");
    expect(result.current.isEnabled).toBe(true);
    expect(result.current.draftEnabled).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const { result } = renderVersioning({ enabled: false });

    await act(async () => result.current.load());
    act(() => result.current.updateDraft(true));
    await act(async () => result.current.save(false));

    expect(apiMocks.getBucketVersioning).not.toHaveBeenCalled();
    expect(apiMocks.setBucketVersioning).not.toHaveBeenCalled();
  });
});

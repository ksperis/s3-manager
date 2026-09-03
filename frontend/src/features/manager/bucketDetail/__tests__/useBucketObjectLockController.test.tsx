import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketObjectLockController } from "../useBucketObjectLockController";

const apiMocks = vi.hoisted(() => ({
  getBucketObjectLock: vi.fn(),
  getCephAdminBucketObjectLock: vi.fn(),
  setBucketVersioning: vi.fn(),
  setCephAdminBucketVersioning: vi.fn(),
  updateBucketObjectLock: vi.fn(),
  updateCephAdminBucketObjectLock: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  getBucketObjectLock: (...args: unknown[]) =>
    apiMocks.getBucketObjectLock(...args),
  setBucketVersioning: (...args: unknown[]) =>
    apiMocks.setBucketVersioning(...args),
  updateBucketObjectLock: (...args: unknown[]) =>
    apiMocks.updateBucketObjectLock(...args),
}));

vi.mock("../../../../api/cephAdminBuckets", () => ({
  getCephAdminBucketObjectLock: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketObjectLock(...args),
  setCephAdminBucketVersioning: (...args: unknown[]) =>
    apiMocks.setCephAdminBucketVersioning(...args),
  updateCephAdminBucketObjectLock: (...args: unknown[]) =>
    apiMocks.updateCephAdminBucketObjectLock(...args),
}));

function renderObjectLock(
  overrides: Partial<
    Parameters<typeof useBucketObjectLockController>[0]
  > = {},
) {
  return renderHook(() =>
    useBucketObjectLockController({
      accountId: "acc-1",
      bucketName: "records",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      onVersioningEnabled: vi.fn(),
      versioningEnabled: true,
      ...overrides,
    }),
  );
}

const enabledConfiguration = {
  days: 30,
  enabled: true,
  mode: "GOVERNANCE",
  years: null,
};

describe("useBucketObjectLockController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, protects, edits, and resets a persistent configuration", async () => {
    apiMocks.getBucketObjectLock.mockResolvedValue(enabledConfiguration);
    const { result } = renderObjectLock();

    await act(async () => result.current.load());
    expect(apiMocks.getBucketObjectLock).toHaveBeenCalledWith(
      "acc-1",
      "records",
    );
    expect(result.current.persistentlyEnabled).toBe(true);
    expect(result.current.active).toBe(true);
    expect(result.current.dirty).toBe(false);

    act(() => result.current.updateEnabled(false));
    expect(result.current.enabled).toBe(true);

    act(() => result.current.updateDays("45"));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.days).toBe("30");
    expect(result.current.dirty).toBe(false);
  });

  it("validates mutually exclusive retention durations", async () => {
    const { result } = renderObjectLock();

    act(() => {
      result.current.updateMode("COMPLIANCE");
      result.current.updateDays("30");
      result.current.updateYears("1");
    });
    await act(async () => result.current.save());

    expect(result.current.error).toBe("Choose days or years, not both.");
    expect(apiMocks.updateBucketObjectLock).not.toHaveBeenCalled();
  });

  it("enables Manager versioning before enabling Object Lock", async () => {
    const onVersioningEnabled = vi.fn();
    apiMocks.setBucketVersioning.mockResolvedValue(undefined);
    apiMocks.updateBucketObjectLock.mockResolvedValue(enabledConfiguration);
    const { result } = renderObjectLock({
      onVersioningEnabled,
      versioningEnabled: false,
    });

    act(() => {
      result.current.updateEnabled(true);
      result.current.updateMode("GOVERNANCE");
      result.current.updateDays("30");
    });
    await act(async () => result.current.save());

    expect(apiMocks.setBucketVersioning).toHaveBeenCalledWith(
      "acc-1",
      "records",
      true,
    );
    expect(apiMocks.updateBucketObjectLock).toHaveBeenCalledWith(
      "acc-1",
      "records",
      enabledConfiguration,
    );
    expect(
      apiMocks.setBucketVersioning.mock.invocationCallOrder[0],
    ).toBeLessThan(apiMocks.updateBucketObjectLock.mock.invocationCallOrder[0]);
    expect(onVersioningEnabled).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("Object Lock updated");
    expect(result.current.dirty).toBe(false);
  });

  it("uses the Ceph Admin Object Lock API when versioning is already enabled", async () => {
    apiMocks.getCephAdminBucketObjectLock.mockResolvedValue(
      enabledConfiguration,
    );
    apiMocks.updateCephAdminBucketObjectLock.mockResolvedValue(
      enabledConfiguration,
    );
    const { result } = renderObjectLock({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    await act(async () => result.current.save());

    expect(apiMocks.getCephAdminBucketObjectLock).toHaveBeenCalledWith(
      7,
      "records",
    );
    expect(apiMocks.updateCephAdminBucketObjectLock).toHaveBeenCalledWith(
      7,
      "records",
      enabledConfiguration,
    );
    expect(apiMocks.setCephAdminBucketVersioning).not.toHaveBeenCalled();
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const { result } = renderObjectLock({ enabled: false });

    await act(async () => result.current.load());
    await act(async () => result.current.save());

    expect(apiMocks.getBucketObjectLock).not.toHaveBeenCalled();
    expect(apiMocks.updateBucketObjectLock).not.toHaveBeenCalled();
  });
});

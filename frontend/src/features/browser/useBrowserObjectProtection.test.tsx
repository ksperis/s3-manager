import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateTime } from "./browserUtils";
import { useBrowserObjectProtection } from "./useBrowserObjectProtection";

const apiMocks = vi.hoisted(() => ({
  getObjectLegalHold: vi.fn(),
  getObjectRetention: vi.fn(),
  updateObjectLegalHold: vi.fn(),
  updateObjectRetention: vi.fn(),
}));

vi.mock("../../api/browser", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browser")>(
      "../../api/browser",
    );
  return {
    ...actual,
    getObjectLegalHold: (...args: unknown[]) =>
      apiMocks.getObjectLegalHold(...args),
    getObjectRetention: (...args: unknown[]) =>
      apiMocks.getObjectRetention(...args),
    updateObjectLegalHold: (...args: unknown[]) =>
      apiMocks.updateObjectLegalHold(...args),
    updateObjectRetention: (...args: unknown[]) =>
      apiMocks.updateObjectRetention(...args),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useBrowserObjectProtection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getObjectLegalHold.mockResolvedValue({ status: "OFF" });
    apiMocks.getObjectRetention.mockResolvedValue({
      mode: "GOVERNANCE",
      retain_until: "2026-09-01T10:30:00Z",
    });
    apiMocks.updateObjectLegalHold.mockResolvedValue(undefined);
    apiMocks.updateObjectRetention.mockResolvedValue(undefined);
  });

  it("loads legal hold and retention together for the active object", async () => {
    const { result } = renderHook(() =>
      useBrowserObjectProtection({
        accountId: "acc-1",
        bucketName: "bucket-a",
        enabled: true,
        objectKey: "docs/report.txt",
        versionId: "v2",
      }),
    );

    await waitFor(() =>
      expect(result.current.retentionMode).toBe("GOVERNANCE"),
    );
    expect(result.current.loading).toBe(false);
    expect(apiMocks.getObjectLegalHold).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      "docs/report.txt",
      "v2",
      undefined,
    );
    expect(apiMocks.getObjectRetention).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      "docs/report.txt",
      "v2",
      undefined,
    );
    expect(result.current.legalHoldStatus).toBe("OFF");
    expect(result.current.retentionMode).toBe("GOVERNANCE");
    expect(result.current.retentionDate).toBe(
      formatLocalDateTime("2026-09-01T10:30:00Z"),
    );
  });

  it("normalizes an unavailable Object Lock configuration", async () => {
    const unavailableError = new Error(
      "InvalidRequest: bucket object lock not configured",
    );
    apiMocks.getObjectLegalHold.mockRejectedValue(unavailableError);
    apiMocks.getObjectRetention.mockRejectedValue(unavailableError);

    const { result } = renderHook(() =>
      useBrowserObjectProtection({
        accountId: "acc-1",
        bucketName: "bucket-a",
        enabled: true,
        objectKey: "docs/report.txt",
      }),
    );

    await waitFor(() =>
      expect(result.current.objectLockUnavailable).toBe(true),
    );
    expect(result.current.objectLockUnavailable).toBe(true);
    expect(result.current.legalHoldError).toBeNull();
    expect(result.current.retentionError).toBeNull();
  });

  it("saves legal hold and retention through the active object version", async () => {
    const { result } = renderHook(() =>
      useBrowserObjectProtection({
        accountId: "acc-1",
        bucketName: "bucket-a",
        enabled: true,
        objectKey: "docs/report.txt",
        versionId: "v2",
      }),
    );
    await waitFor(() =>
      expect(result.current.retentionMode).toBe("GOVERNANCE"),
    );

    act(() => result.current.setLegalHoldStatus("ON"));
    await act(async () => {
      expect(await result.current.saveLegalHold()).toBe(true);
    });
    expect(apiMocks.updateObjectLegalHold).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        key: "docs/report.txt",
        status: "ON",
        version_id: "v2",
      },
      undefined,
      undefined,
    );

    const retentionDate = "2026-12-01T12:00";
    act(() => {
      result.current.setRetentionMode("COMPLIANCE");
      result.current.setRetentionDate(retentionDate);
      result.current.setRetentionBypass(true);
    });
    await act(async () => {
      expect(await result.current.saveRetention()).toBe("saved");
    });
    expect(apiMocks.updateObjectRetention).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        key: "docs/report.txt",
        mode: "COMPLIANCE",
        retain_until: new Date(retentionDate).toISOString(),
        bypass_governance: true,
        version_id: "v2",
      },
      undefined,
      undefined,
    );
    expect(result.current.savingLegalHold).toBe(false);
    expect(result.current.savingRetention).toBe(false);

    act(() => result.current.setRetentionDate("not-a-date"));
    await act(async () => {
      expect(await result.current.saveRetention()).toBe("invalid");
    });
    expect(apiMocks.updateObjectRetention).toHaveBeenCalledTimes(1);
  });

  it("does not reload an object after its pending legal hold save becomes stale", async () => {
    const pendingUpdate = deferred<void>();
    const { result, rerender } = renderHook(
      ({ objectKey }) =>
        useBrowserObjectProtection({
          accountId: "acc-1",
          bucketName: "bucket-a",
          enabled: true,
          objectKey,
        }),
      { initialProps: { objectKey: "docs/old.txt" } },
    );
    await waitFor(() =>
      expect(apiMocks.getObjectLegalHold).toHaveBeenCalledTimes(1),
    );
    apiMocks.updateObjectLegalHold.mockReturnValueOnce(pendingUpdate.promise);

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = result.current.saveLegalHold();
    });
    await waitFor(() => expect(result.current.savingLegalHold).toBe(true));

    rerender({ objectKey: "docs/current.txt" });
    await waitFor(() =>
      expect(apiMocks.getObjectLegalHold).toHaveBeenCalledTimes(2),
    );
    await act(async () => {
      pendingUpdate.resolve(undefined);
      expect(await savePromise).toBe(false);
    });
    expect(apiMocks.getObjectLegalHold).toHaveBeenCalledTimes(2);
    expect(result.current.savingLegalHold).toBe(false);
  });

  it("ignores protection responses from a previously selected object", async () => {
    const oldLegalHold = deferred<{ status: "ON" }>();
    const oldRetention = deferred<{
      mode: "COMPLIANCE";
      retain_until: string;
    }>();
    apiMocks.getObjectLegalHold
      .mockReturnValueOnce(oldLegalHold.promise)
      .mockResolvedValueOnce({ status: "OFF" });
    apiMocks.getObjectRetention
      .mockReturnValueOnce(oldRetention.promise)
      .mockResolvedValueOnce({
        mode: "GOVERNANCE",
        retain_until: "2026-10-01T09:00:00Z",
      });

    const { result, rerender } = renderHook(
      ({ objectKey }) =>
        useBrowserObjectProtection({
          accountId: "acc-1",
          bucketName: "bucket-a",
          enabled: true,
          objectKey,
        }),
      { initialProps: { objectKey: "docs/old.txt" } },
    );
    await waitFor(() =>
      expect(apiMocks.getObjectLegalHold).toHaveBeenCalledTimes(1),
    );
    const previousLoad = result.current.load;

    rerender({ objectKey: "docs/current.txt" });
    await waitFor(() => {
      expect(apiMocks.getObjectLegalHold).toHaveBeenCalledTimes(2);
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      await previousLoad(true);
    });
    expect(apiMocks.getObjectLegalHold).toHaveBeenCalledTimes(2);

    await act(async () => {
      oldLegalHold.resolve({ status: "ON" });
      oldRetention.resolve({
        mode: "COMPLIANCE",
        retain_until: "2030-01-01T00:00:00Z",
      });
      await Promise.all([oldLegalHold.promise, oldRetention.promise]);
    });
    expect(result.current.legalHoldStatus).toBe("OFF");
    expect(result.current.retentionMode).toBe("GOVERNANCE");
    expect(result.current.retentionDate).toBe(
      formatLocalDateTime("2026-10-01T09:00:00Z"),
    );
  });
});

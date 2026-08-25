import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateTime } from "./browserUtils";
import { useBrowserObjectProtection } from "./useBrowserObjectProtection";

const apiMocks = vi.hoisted(() => ({
  getObjectLegalHold: vi.fn(),
  getObjectRetention: vi.fn(),
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

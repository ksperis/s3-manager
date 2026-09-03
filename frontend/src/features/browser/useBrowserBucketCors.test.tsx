import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BucketCorsStatus } from "../../api/browserContracts";
import { useBrowserBucketCors } from "./useBrowserBucketCors";

const apiMocks = vi.hoisted(() => ({
  ensureBucketCors: vi.fn(),
  getBucketCorsStatus: vi.fn(),
}));

vi.mock("../../api/browser", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browser")>(
      "../../api/browser",
    );
  return {
    ...actual,
    ensureBucketCors: (...args: unknown[]) =>
      apiMocks.ensureBucketCors(...args),
    getBucketCorsStatus: (...args: unknown[]) =>
      apiMocks.getBucketCorsStatus(...args),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const disabledCors: BucketCorsStatus = { enabled: false, rules: [] };
const enabledCors: BucketCorsStatus = { enabled: true, rules: [] };

describe("useBrowserBucketCors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getBucketCorsStatus.mockResolvedValue(disabledCors);
    apiMocks.ensureBucketCors.mockResolvedValue(enabledCors);
  });

  it("applies CORS for the active bucket and closes its action popover", async () => {
    const setStatusMessage = vi.fn();
    const { result } = renderHook(() =>
      useBrowserBucketCors({
        accountIdForApi: "acc-1",
        allowAction: true,
        bucketName: "bucket-a",
        enabled: true,
        origin: "https://ui.example.test",
        setStatusMessage,
      }),
    );
    await waitFor(() => expect(result.current.actionAvailable).toBe(true));

    act(() => result.current.togglePopover());
    expect(result.current.popoverOpen).toBe(true);
    await act(async () => {
      await result.current.ensureCors();
    });

    expect(apiMocks.ensureBucketCors).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      "https://ui.example.test",
      undefined,
    );
    expect(result.current.status?.enabled).toBe(true);
    expect(result.current.popoverOpen).toBe(false);
    expect(setStatusMessage).toHaveBeenLastCalledWith(
      "CORS rules updated for this bucket.",
    );
  });

  it("ignores a status response from a previously selected bucket", async () => {
    const bucketARequest = deferred<BucketCorsStatus>();
    const bucketBRequest = deferred<BucketCorsStatus>();
    apiMocks.getBucketCorsStatus.mockImplementation(
      (_accountId: string, bucketName: string) =>
        bucketName === "bucket-a"
          ? bucketARequest.promise
          : bucketBRequest.promise,
    );

    const { result, rerender } = renderHook(
      ({ bucketName }) =>
        useBrowserBucketCors({
          accountIdForApi: "acc-1",
          allowAction: true,
          bucketName,
          enabled: true,
          origin: "https://ui.example.test",
          setStatusMessage: vi.fn(),
        }),
      { initialProps: { bucketName: "bucket-a" } },
    );

    await waitFor(() => {
      expect(apiMocks.getBucketCorsStatus).toHaveBeenCalledWith(
        "acc-1",
        "bucket-a",
        "https://ui.example.test",
        undefined,
      );
    });
    rerender({ bucketName: "bucket-b" });
    await waitFor(() => {
      expect(apiMocks.getBucketCorsStatus).toHaveBeenCalledWith(
        "acc-1",
        "bucket-b",
        "https://ui.example.test",
        undefined,
      );
    });

    await act(async () => {
      bucketBRequest.resolve(disabledCors);
    });
    await waitFor(() => expect(result.current.status?.enabled).toBe(false));

    await act(async () => {
      bucketARequest.resolve(enabledCors);
    });
    expect(result.current.status?.enabled).toBe(false);
  });

  it("does not offer CORS repair when the status could not be checked", async () => {
    apiMocks.getBucketCorsStatus.mockResolvedValue({
      enabled: false,
      rules: [],
      error: "AccessDenied",
    });

    const { result } = renderHook(() =>
      useBrowserBucketCors({
        accountIdForApi: "acc-1",
        allowAction: true,
        bucketName: "bucket-a",
        enabled: true,
        origin: "https://ui.example.test",
        setStatusMessage: vi.fn(),
      }),
    );

    await waitFor(() =>
      expect(result.current.status?.error).toBe("AccessDenied"),
    );
    expect(result.current.actionAvailable).toBe(false);
  });
});

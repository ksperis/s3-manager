import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateTime } from "./browserUtils";
import { useBrowserObjectSignedUrl } from "./useBrowserObjectSignedUrl";

const apiMocks = vi.hoisted(() => ({
  presignObject: vi.fn(),
}));

vi.mock("../../api/browserTransfers", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserTransfers")>(
      "../../api/browserTransfers",
    );
  return {
    ...actual,
    presignObject: (...args: unknown[]) => apiMocks.presignObject(...args),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useBrowserObjectSignedUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T10:00:00Z"));
    apiMocks.presignObject.mockResolvedValue({
      url: "https://objects.example.test/report.txt",
      method: "GET",
      headers: { "x-test": "value" },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates a signed URL within the allowed expiration window", async () => {
    const { result } = renderHook(() =>
      useBrowserObjectSignedUrl({
        accountId: "acc-1",
        bucketName: "bucket-a",
        objectKey: "docs/report.txt",
        sseCustomerKeyBase64: "customer-key",
      }),
    );

    await act(async () => {
      expect(await result.current.generate()).toEqual({ status: "generated" });
    });
    expect(apiMocks.presignObject).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        key: "docs/report.txt",
        operation: "get_object",
        expires_in: 3600,
      },
      "customer-key",
      undefined,
    );
    expect(result.current.url).toBe(
      "https://objects.example.test/report.txt",
    );
    expect(result.current.method).toBe("GET");
    expect(result.current.headers).toEqual({ "x-test": "value" });
    expect(result.current.generating).toBe(false);
  });

  it("rejects invalid, short, and excessive expiration values locally", async () => {
    const { result } = renderHook(() =>
      useBrowserObjectSignedUrl({
        accountId: "acc-1",
        bucketName: "bucket-a",
        objectKey: "docs/report.txt",
      }),
    );

    act(() => result.current.setExpires(""));
    await act(async () => {
      expect(await result.current.generate()).toEqual({
        status: "validation-error",
      });
    });
    expect(result.current.error).toBe("Select a valid expiration date.");

    act(() =>
      result.current.setExpires(
        formatLocalDateTime(new Date(Date.now() + 30 * 1000)),
      ),
    );
    await act(async () => {
      expect(await result.current.generate()).toEqual({
        status: "validation-error",
      });
    });
    expect(result.current.error).toBe(
      "Expiration must be at least 1 minute from now.",
    );

    act(() =>
      result.current.setExpires(
        formatLocalDateTime(new Date(Date.now() + 13 * 60 * 60 * 1000)),
      ),
    );
    await act(async () => {
      expect(await result.current.generate()).toEqual({
        status: "validation-error",
      });
    });
    expect(result.current.error).toBe("Expiration must be within 12 hours.");
    expect(apiMocks.presignObject).not.toHaveBeenCalled();
  });

  it("discards a signed URL generated for a previously selected object", async () => {
    const pendingPresign = deferred<{
      url: string;
      method: string;
      headers: Record<string, string>;
    }>();
    apiMocks.presignObject.mockReturnValueOnce(pendingPresign.promise);
    const { result, rerender } = renderHook(
      ({ objectKey }) =>
        useBrowserObjectSignedUrl({
          accountId: "acc-1",
          bucketName: "bucket-a",
          objectKey,
        }),
      { initialProps: { objectKey: "docs/old.txt" } },
    );

    let generatePromise!: ReturnType<typeof result.current.generate>;
    act(() => {
      generatePromise = result.current.generate();
    });
    expect(result.current.generating).toBe(true);
    rerender({ objectKey: "docs/current.txt" });
    expect(result.current.generating).toBe(false);

    await act(async () => {
      pendingPresign.resolve({
        url: "https://objects.example.test/old.txt",
        method: "GET",
        headers: {},
      });
      expect(await generatePromise).toEqual({ status: "skipped" });
    });
    expect(result.current.url).toBe("");
  });

  it("uses Clipboard when available and otherwise returns the dialog value", async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      const { result } = renderHook(() =>
        useBrowserObjectSignedUrl({
          accountId: "acc-1",
          bucketName: "bucket-a",
          objectKey: "docs/report.txt",
        }),
      );
      await act(async () => {
        await result.current.generate();
      });
      await act(async () => {
        expect(await result.current.copy()).toEqual({ status: "copied" });
      });
      expect(writeText).toHaveBeenCalledWith(
        "https://objects.example.test/report.txt",
      );

      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      await act(async () => {
        expect(await result.current.copy()).toEqual({
          status: "fallback",
          value: "https://objects.example.test/report.txt",
        });
      });
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });
});

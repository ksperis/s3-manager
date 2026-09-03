import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserObjectArchiveRestore } from "./useBrowserObjectArchiveRestore";

const apiMocks = vi.hoisted(() => ({
  restoreObject: vi.fn(),
}));

vi.mock("../../api/browserObjects", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserObjects")>(
      "../../api/browserObjects",
    );
  return {
    ...actual,
    restoreObject: (...args: unknown[]) => apiMocks.restoreObject(...args),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useBrowserObjectArchiveRestore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.restoreObject.mockResolvedValue(undefined);
  });

  it("submits the selected restore window and reloads object properties", async () => {
    const loadProperties = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useBrowserObjectArchiveRestore({
        accountId: "acc-1",
        bucketName: "bucket-a",
        loadProperties,
        objectKey: "archives/report.csv",
        requestOptions: { workspaceSurface: "manager" },
        versionId: "version-2",
      }),
    );

    act(() => {
      result.current.setDays("14");
      result.current.setTier("Bulk");
    });
    await act(async () => {
      expect(await result.current.restore()).toBe("restored");
    });

    expect(apiMocks.restoreObject).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        key: "archives/report.csv",
        days: 14,
        tier: "Bulk",
        version_id: "version-2",
      },
      { workspaceSurface: "manager" },
    );
    expect(loadProperties).toHaveBeenCalledWith(true);
    expect(result.current.saving).toBe(false);
  });

  it.each(["", "0", "-1", "not-a-number"])(
    "rejects the invalid restore duration %j locally",
    async (days) => {
      const loadProperties = vi.fn();
      const { result } = renderHook(() =>
        useBrowserObjectArchiveRestore({
          accountId: "acc-1",
          bucketName: "bucket-a",
          loadProperties,
          objectKey: "archives/report.csv",
        }),
      );

      act(() => result.current.setDays(days));
      await act(async () => {
        expect(await result.current.restore()).toBe("invalid");
      });
      expect(apiMocks.restoreObject).not.toHaveBeenCalled();
      expect(loadProperties).not.toHaveBeenCalled();
    },
  );

  it("discards a restore response for a previously selected object", async () => {
    const pendingRestore = deferred<void>();
    apiMocks.restoreObject.mockReturnValueOnce(pendingRestore.promise);
    const loadProperties = vi.fn();
    const { result, rerender } = renderHook(
      ({ objectKey }) =>
        useBrowserObjectArchiveRestore({
          accountId: "acc-1",
          bucketName: "bucket-a",
          loadProperties,
          objectKey,
        }),
      { initialProps: { objectKey: "archives/old.csv" } },
    );

    let restorePromise!: ReturnType<typeof result.current.restore>;
    act(() => {
      restorePromise = result.current.restore();
    });
    expect(result.current.saving).toBe(true);
    rerender({ objectKey: "archives/current.csv" });
    expect(result.current.saving).toBe(false);

    await act(async () => {
      pendingRestore.resolve();
      expect(await restorePromise).toBe("skipped");
    });
    expect(loadProperties).not.toHaveBeenCalled();
  });
});

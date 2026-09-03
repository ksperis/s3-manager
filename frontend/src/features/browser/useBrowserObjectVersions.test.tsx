import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserObjectVersion } from "../../api/browserContracts";
import { useBrowserObjectVersions } from "./useBrowserObjectVersions";

const apiMocks = vi.hoisted(() => ({
  listObjectVersions: vi.fn(),
}));

vi.mock("../../api/browser", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browser")>(
      "../../api/browser",
    );
  return {
    ...actual,
    listObjectVersions: (...args: unknown[]) =>
      apiMocks.listObjectVersions(...args),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function version(versionId: string): BrowserObjectVersion {
  return {
    key: "docs/report.txt",
    version_id: versionId,
    is_latest: versionId === "v2",
    is_delete_marker: false,
  };
}

describe("useBrowserObjectVersions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and appends version pages with the returned markers", async () => {
    apiMocks.listObjectVersions
      .mockResolvedValueOnce({
        versions: [version("v2")],
        delete_markers: [],
        is_truncated: true,
        next_key_marker: "docs/report.txt",
        next_version_id_marker: "v2",
      })
      .mockResolvedValueOnce({
        versions: [version("v1")],
        delete_markers: [],
        is_truncated: false,
      });

    const { result } = renderHook(() =>
      useBrowserObjectVersions({
        accountId: "acc-1",
        bucketName: "bucket-a",
        enabled: true,
        onDeleteVersion: vi.fn(),
        onRestoreVersion: vi.fn(),
        objectKey: "docs/report.txt",
      }),
    );

    await act(async () => {
      await result.current.load();
    });
    expect(result.current.rows.map((row) => row.version_id)).toEqual(["v2"]);
    expect(result.current.latestRow?.version_id).toBe("v2");
    expect(result.current.canLoadMore).toBe(true);

    await act(async () => {
      await result.current.load({ append: true });
    });
    expect(apiMocks.listObjectVersions).toHaveBeenNthCalledWith(
      2,
      "acc-1",
      "bucket-a",
      {
        key: "docs/report.txt",
        keyMarker: "docs/report.txt",
        versionIdMarker: "v2",
        maxKeys: undefined,
        requestOptions: undefined,
      },
    );
    expect(result.current.rows.map((row) => row.version_id)).toEqual([
      "v2",
      "v1",
    ]);
    expect(result.current.canLoadMore).toBe(false);
  });

  it("ignores a response from an object that is no longer selected", async () => {
    const pendingRequest = deferred<{
      versions: BrowserObjectVersion[];
      delete_markers: BrowserObjectVersion[];
      is_truncated: boolean;
    }>();
    apiMocks.listObjectVersions.mockReturnValueOnce(pendingRequest.promise);

    const { result, rerender } = renderHook(
      ({ objectKey }) =>
        useBrowserObjectVersions({
          accountId: "acc-1",
          bucketName: "bucket-a",
          enabled: true,
          onDeleteVersion: vi.fn(),
          onRestoreVersion: vi.fn(),
          objectKey,
        }),
      { initialProps: { objectKey: "docs/report.txt" } },
    );

    act(() => {
      void result.current.load();
    });
    const previousLoad = result.current.load;
    await waitFor(() => expect(result.current.loading).toBe(true));
    rerender({ objectKey: "docs/other.txt" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await previousLoad({ force: true });
    });
    expect(apiMocks.listObjectVersions).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingRequest.resolve({
        versions: [version("v2")],
        delete_markers: [],
        is_truncated: false,
      });
      await pendingRequest.promise;
    });
    expect(result.current.rows).toEqual([]);
    expect(result.current.loaded).toBe(false);
  });

  it("runs restore and delete actions before reloading the version list", async () => {
    const onDeleteVersion = vi.fn().mockResolvedValue(undefined);
    const onRestoreVersion = vi.fn().mockResolvedValue(undefined);
    apiMocks.listObjectVersions.mockResolvedValue({
      versions: [],
      delete_markers: [],
      is_truncated: false,
    });
    const { result } = renderHook(() =>
      useBrowserObjectVersions({
        accountId: "acc-1",
        bucketName: "bucket-a",
        enabled: true,
        onDeleteVersion,
        onRestoreVersion,
        objectKey: "docs/report.txt",
      }),
    );
    const targetVersion = version("v1");

    await act(async () => {
      expect(await result.current.runAction("restore", targetVersion)).toBe(
        true,
      );
    });
    await act(async () => {
      expect(await result.current.runAction("delete", targetVersion)).toBe(
        true,
      );
    });

    expect(onRestoreVersion).toHaveBeenCalledWith(targetVersion);
    expect(onDeleteVersion).toHaveBeenCalledWith(targetVersion);
    expect(apiMocks.listObjectVersions).toHaveBeenCalledTimes(2);
    expect(result.current.savingAction).toBe(false);
  });

  it("does not reload versions after an action on a previously selected object", async () => {
    const pendingRestore = deferred<void>();
    const onRestoreVersion = vi.fn().mockReturnValue(pendingRestore.promise);
    const { result, rerender } = renderHook(
      ({ objectKey }) =>
        useBrowserObjectVersions({
          accountId: "acc-1",
          bucketName: "bucket-a",
          enabled: true,
          onDeleteVersion: vi.fn(),
          onRestoreVersion,
          objectKey,
        }),
      { initialProps: { objectKey: "docs/report.txt" } },
    );

    let actionPromise!: ReturnType<typeof result.current.runAction>;
    act(() => {
      actionPromise = result.current.runAction("restore", version("v1"));
    });
    expect(result.current.savingAction).toBe(true);
    rerender({ objectKey: "docs/other.txt" });
    expect(result.current.savingAction).toBe(false);

    await act(async () => {
      pendingRestore.resolve();
      expect(await actionPromise).toBe(false);
    });
    expect(apiMocks.listObjectVersions).not.toHaveBeenCalled();
  });
});

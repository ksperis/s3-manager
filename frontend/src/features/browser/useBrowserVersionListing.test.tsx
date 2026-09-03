import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserObjectVersion } from "../../api/browserContracts";
import { useBrowserVersionListing } from "./useBrowserVersionListing";

const apiMocks = vi.hoisted(() => ({
  listObjectVersions: vi.fn(),
}));

vi.mock("../../api/browserObjects", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserObjects")>(
      "../../api/browserObjects",
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

function version(key: string, versionId: string): BrowserObjectVersion {
  return {
    key,
    version_id: versionId,
    is_latest: versionId === "v3",
    is_delete_marker: false,
  };
}

const response = (
  versions: BrowserObjectVersion[],
  markers?: { key: string; versionId: string },
) => ({
  versions,
  delete_markers: [],
  is_truncated: Boolean(markers),
  next_key_marker: markers?.key ?? null,
  next_version_id_marker: markers?.versionId ?? null,
});

describe("useBrowserVersionListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shares prefix pagination and enforces the configured hard limit", async () => {
    const onHardLimit = vi.fn();
    apiMocks.listObjectVersions
      .mockResolvedValueOnce(
        response([version("docs/report.txt", "v3")], {
          key: "docs/report.txt",
          versionId: "v3",
        }),
      )
      .mockResolvedValueOnce(
        response([
          version("docs/report.txt", "v2"),
          version("docs/report.txt", "v1"),
        ]),
      );

    const { result } = renderHook(() =>
      useBrowserVersionListing({
        accountId: "acc-1",
        bucketName: "bucket-a",
        enabled: true,
        hardLimit: 2,
        onHardLimit,
        pageSize: 1000,
        prefix: "docs/",
      }),
    );

    await act(async () => {
      await result.current.load();
      await result.current.load({ append: true });
    });

    expect(apiMocks.listObjectVersions).toHaveBeenNthCalledWith(
      2,
      "acc-1",
      "bucket-a",
      {
        prefix: "docs/",
        keyMarker: "docs/report.txt",
        versionIdMarker: "v3",
        maxKeys: 1000,
        requestOptions: undefined,
      },
    );
    expect(result.current.rows.map((row) => row.version_id)).toEqual([
      "v3",
      "v2",
    ]);
    expect(result.current.canLoadMore).toBe(false);
    expect(onHardLimit).toHaveBeenCalledOnce();
  });

  it("auto-loads a new object scope and ignores the previous response", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    apiMocks.listObjectVersions
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response([version("docs/new.txt", "v3")]));

    const { result, rerender } = renderHook(
      ({ objectKey }) =>
        useBrowserVersionListing({
          accountId: "acc-1",
          autoLoad: true,
          bucketName: "bucket-a",
          enabled: true,
          objectKey,
        }),
      { initialProps: { objectKey: "docs/old.txt" } },
    );

    await waitFor(() =>
      expect(apiMocks.listObjectVersions).toHaveBeenCalledOnce(),
    );
    rerender({ objectKey: "docs/new.txt" });
    await waitFor(() =>
      expect(apiMocks.listObjectVersions).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(result.current.rows.map((row) => row.key)).toEqual([
        "docs/new.txt",
      ]),
    );

    await act(async () => {
      pending.resolve(response([version("docs/old.txt", "v3")]));
      await pending.promise;
    });

    expect(result.current.rows.map((row) => row.key)).toEqual([
      "docs/new.txt",
    ]);
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserObjectVersion } from "../../api/browser";
import { useBrowserPrefixVersions } from "./useBrowserPrefixVersions";

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

function version(versionId: string): BrowserObjectVersion {
  return {
    key: "docs/report.txt",
    version_id: versionId,
    is_latest: versionId === "v2",
    is_delete_marker: false,
  };
}

function response(
  versions: BrowserObjectVersion[],
  markers?: { key: string; versionId: string },
) {
  return {
    versions,
    delete_markers: [],
    is_truncated: Boolean(markers),
    next_key_marker: markers?.key ?? null,
    next_version_id_marker: markers?.versionId ?? null,
  };
}

function renderPrefixVersions(versioningEnabled = true) {
  return renderHook(
    ({ enabled }) =>
      useBrowserPrefixVersions({
        accountId: "acc-1",
        bucketName: "bucket-a",
        contextEnabled: true,
        onHardLimit: vi.fn(),
        prefix: "docs/",
        versioningEnabled: enabled,
      }),
    { initialProps: { enabled: versioningEnabled } },
  );
}

describe("useBrowserPrefixVersions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("owns opening, pagination, refresh, and closing", async () => {
    apiMocks.listObjectVersions
      .mockResolvedValueOnce(
        response([version("v2")], {
          key: "docs/report.txt",
          versionId: "v2",
        }),
      )
      .mockResolvedValueOnce(response([version("v1")]))
      .mockResolvedValueOnce(response([version("v2")]))
      .mockResolvedValue(response([version("v2")]));
    const { result } = renderPrefixVersions();

    await act(async () => result.current.refreshIfVisible());
    expect(apiMocks.listObjectVersions).not.toHaveBeenCalled();

    act(() => result.current.open());
    await waitFor(() => {
      expect(apiMocks.listObjectVersions).toHaveBeenCalledOnce();
      expect(result.current.canLoadMore).toBe(true);
    });
    await act(async () => result.current.loadMore());
    expect(apiMocks.listObjectVersions).toHaveBeenNthCalledWith(
      2,
      "acc-1",
      "bucket-a",
      expect.objectContaining({
        prefix: "docs/",
        keyMarker: "docs/report.txt",
        versionIdMarker: "v2",
      }),
    );
    expect(result.current.canLoadMore).toBe(false);
    await act(async () => result.current.refresh());
    expect(apiMocks.listObjectVersions).toHaveBeenCalledTimes(3);

    act(() => result.current.close());
    expect(result.current.visible).toBe(false);
  });

  it("closes when versioning becomes unavailable", async () => {
    apiMocks.listObjectVersions.mockResolvedValue(response([version("v2")]));
    const { result, rerender } = renderPrefixVersions();

    act(() => result.current.open());
    await waitFor(() => expect(result.current.visible).toBe(true));
    rerender({ enabled: false });

    await waitFor(() => expect(result.current.visible).toBe(false));
  });
});

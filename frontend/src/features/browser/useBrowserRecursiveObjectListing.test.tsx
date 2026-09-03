import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserRecursiveObjectListing } from "./useBrowserRecursiveObjectListing";

const apiMocks = vi.hoisted(() => ({
  listBrowserObjects: vi.fn(),
}));

vi.mock("../../api/browserObjects", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserObjects")>(
      "../../api/browserObjects",
    );
  return {
    ...actual,
    listBrowserObjects: (...args: unknown[]) =>
      apiMocks.listBrowserObjects(...args),
  };
});

function renderRecursiveListing({
  bucketName = "bucket-a",
  enabled = true,
}: {
  bucketName?: string;
  enabled?: boolean;
} = {}) {
  return renderHook(() =>
    useBrowserRecursiveObjectListing({
      accountId: "account-1",
      bucketName,
      enabled,
      requestOptions: { workspaceSurface: "manager" },
    }),
  );
}

describe("useBrowserRecursiveObjectListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { bucketName: "", enabled: true },
    { bucketName: "bucket-a", enabled: false },
  ])("returns no objects outside an enabled bucket context", async (options) => {
    const { result } = renderRecursiveListing(options);

    await expect(result.current("reports/")).resolves.toEqual([]);
    expect(apiMocks.listBrowserObjects).not.toHaveBeenCalled();
  });

  it("collects every recursive object page with the current context", async () => {
    apiMocks.listBrowserObjects
      .mockResolvedValueOnce({
        prefix: "reports/",
        objects: [{ key: "reports/a.csv", size: 10 }],
        prefixes: [],
        is_truncated: true,
        next_continuation_token: "page-2",
      })
      .mockResolvedValueOnce({
        prefix: "reports/",
        objects: [{ key: "reports/b.csv", size: 20 }],
        prefixes: [],
        is_truncated: false,
      });
    const { result } = renderRecursiveListing();

    await expect(result.current("reports/")).resolves.toEqual([
      { key: "reports/a.csv", size: 10 },
      { key: "reports/b.csv", size: 20 },
    ]);

    expect(apiMocks.listBrowserObjects).toHaveBeenNthCalledWith(
      1,
      "account-1",
      "bucket-a",
      {
        prefix: "reports/",
        continuationToken: null,
        maxKeys: 1000,
        type: "file",
        recursive: true,
        signal: undefined,
        workspaceSurface: "manager",
      },
    );
    expect(apiMocks.listBrowserObjects).toHaveBeenNthCalledWith(
      2,
      "account-1",
      "bucket-a",
      expect.objectContaining({ continuationToken: "page-2" }),
    );
  });

  it("uses an explicit account, bucket, and abort signal", async () => {
    apiMocks.listBrowserObjects.mockResolvedValue({
      prefix: "archive/",
      objects: [],
      prefixes: [],
      is_truncated: false,
    });
    const controller = new AbortController();
    const { result } = renderRecursiveListing();

    await result.current(
      "archive/",
      "bucket-b",
      "account-2",
      controller.signal,
    );

    expect(apiMocks.listBrowserObjects).toHaveBeenCalledWith(
      "account-2",
      "bucket-b",
      expect.objectContaining({
        signal: controller.signal,
        workspaceSurface: "manager",
      }),
    );
  });

  it("stops when a truncated response has no continuation token", async () => {
    apiMocks.listBrowserObjects.mockResolvedValue({
      prefix: "reports/",
      objects: [{ key: "reports/a.csv", size: 10 }],
      prefixes: [],
      is_truncated: true,
      next_continuation_token: null,
    });
    const { result } = renderRecursiveListing();

    await expect(result.current("reports/")).resolves.toHaveLength(1);
    expect(apiMocks.listBrowserObjects).toHaveBeenCalledTimes(1);
  });
});

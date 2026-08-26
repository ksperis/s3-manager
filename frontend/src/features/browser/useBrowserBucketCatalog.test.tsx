import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBrowserRootContextSelection } from "./browserRootUiState";
import { useBrowserBucketCatalog } from "./useBrowserBucketCatalog";

const apiMocks = vi.hoisted(() => ({
  listBrowserObjects: vi.fn(),
  searchBrowserBuckets: vi.fn(),
}));

vi.mock("../../api/browser", async () => ({
  ...(await vi.importActual<typeof import("../../api/browser")>(
    "../../api/browser",
  )),
  ...apiMocks,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function bucketPage(
  names: string[],
  options: { hasNext?: boolean; page?: number; total?: number } = {},
) {
  return {
    items: names.map((name) => ({ name })),
    total: options.total ?? names.length,
    page: options.page ?? 1,
    page_size: names.length,
    has_next: options.hasNext ?? false,
  };
}

function createOptions() {
  return {
    accountId: "account-a",
    accessContextKey: "browser:account-a",
    browserRootContextId: "account-a",
    enabled: true,
    isCephAdminContext: false,
    isMainBrowserPath: true,
    lockedBucketName: "",
    onSelectedBucketNameChange: vi.fn(),
    requestOptions: { workspaceSurface: "browser" as const },
    requestedBucket: "",
    requestedPrefix: "",
    searchActive: false,
    usePortalWorkspaceLabels: false,
  };
}

describe("useBrowserBucketCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects the requested bucket and persists its current root path", async () => {
    apiMocks.searchBrowserBuckets.mockResolvedValue(
      bucketPage(["bucket-a", "bucket-b"]),
    );
    const onSelectedBucketNameChange = vi.fn();
    const { result } = renderHook(() =>
      useBrowserBucketCatalog({
        ...createOptions(),
        onSelectedBucketNameChange,
        requestedBucket: "bucket-b",
        requestedPrefix: "docs/",
      }),
    );

    await waitFor(() => {
      expect(result.current.bucketName).toBe("bucket-b");
      expect(result.current.prefix).toBe("docs/");
    });
    expect(apiMocks.searchBrowserBuckets).toHaveBeenCalledOnce();
    expect(onSelectedBucketNameChange).toHaveBeenCalledWith("bucket-b");

    act(() => result.current.setPrefix("reports/"));
    await waitFor(() => {
      expect(readBrowserRootContextSelection("account-a")).toEqual({
        bucketName: "bucket-b",
        prefix: "reports/",
      });
    });
  });

  it("ignores a catalogue response from the previous account", async () => {
    const accountARequest = deferred<ReturnType<typeof bucketPage>>();
    apiMocks.searchBrowserBuckets.mockImplementation((accountId: string) =>
      accountId === "account-a"
        ? accountARequest.promise
        : Promise.resolve(bucketPage(["bucket-b"])),
    );
    const { result, rerender } = renderHook(
      ({ accountId, accessContextKey, browserRootContextId }) =>
        useBrowserBucketCatalog({
          ...createOptions(),
          accountId,
          accessContextKey,
          browserRootContextId,
        }),
      {
        initialProps: {
          accountId: "account-a",
          accessContextKey: "browser:account-a",
          browserRootContextId: "account-a",
        },
      },
    );

    await waitFor(() => {
      expect(apiMocks.searchBrowserBuckets).toHaveBeenCalledWith(
        "account-a",
        expect.objectContaining({ page: 1 }),
      );
    });
    rerender({
      accountId: "account-b",
      accessContextKey: "browser:account-b",
      browserRootContextId: "account-b",
    });
    await waitFor(() => {
      expect(result.current.bucketName).toBe("bucket-b");
      expect(result.current.bucketMenuItems).toEqual([{ name: "bucket-b" }]);
    });

    await act(async () => {
      accountARequest.resolve(bucketPage(["bucket-a"]));
      await accountARequest.promise;
    });
    expect(result.current.bucketName).toBe("bucket-b");
    expect(result.current.bucketMenuItems).toEqual([{ name: "bucket-b" }]);
    expect(result.current.loadingBuckets).toBe(false);
  });

  it("debounces searches and appends the next result page", async () => {
    vi.useFakeTimers();
    apiMocks.searchBrowserBuckets.mockImplementation(
      (_accountId: string, options?: { page?: number; search?: string }) => {
        if (options?.search === "archive" && options.page === 2) {
          return Promise.resolve(
            bucketPage(["archive-3"], { page: 2, total: 3 }),
          );
        }
        if (options?.search === "archive") {
          return Promise.resolve(
            bucketPage(["archive-1", "archive-2"], {
              hasNext: true,
              total: 3,
            }),
          );
        }
        return Promise.resolve(bucketPage(["bucket-a", "bucket-b"]));
      },
    );
    const { result } = renderHook(() =>
      useBrowserBucketCatalog({
        ...createOptions(),
        searchActive: true,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => result.current.setBucketFilter("archive"));
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.bucketMenuItems).toEqual([
      { name: "archive-1" },
      { name: "archive-2" },
    ]);
    expect(result.current.canLoadMore).toBe(true);

    act(() => result.current.loadMore());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.bucketMenuItems).toEqual([
      { name: "archive-1" },
      { name: "archive-2" },
      { name: "archive-3" },
    ]);
  });
});

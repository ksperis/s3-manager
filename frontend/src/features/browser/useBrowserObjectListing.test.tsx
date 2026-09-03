import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserObject,
  ListBrowserObjectsResponse,
} from "../../api/browserContracts";
import { useBrowserObjectListing } from "./useBrowserObjectListing";

const apiMocks = vi.hoisted(() => ({
  getBucketVersioning: vi.fn(),
  listBrowserObjects: vi.fn(),
  listObjectVersions: vi.fn(),
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

function object(key: string): BrowserObject {
  return {
    key,
    size: 10,
    last_modified: "2026-08-26T10:00:00Z",
    etag: `"${key}"`,
    storage_class: "STANDARD",
  };
}

function objectPage(
  objects: BrowserObject[],
  options: { nextToken?: string | null; prefixes?: string[] } = {},
): ListBrowserObjectsResponse {
  return {
    prefix: "",
    objects,
    prefixes: options.prefixes ?? [],
    is_truncated: Boolean(options.nextToken),
    next_continuation_token: options.nextToken ?? null,
  };
}

function createOptions() {
  return {
    accountId: "account-a",
    accountSwitchInFlight: false,
    bucketName: "bucket-a",
    caseSensitive: false,
    enabled: true,
    exactMatch: false,
    filter: "",
    getBucketAccessEntry: vi.fn(() => ({
      status: "unknown" as const,
      detail: null,
    })),
    isPortalProfile: false,
    onWarning: vi.fn(),
    prefix: "",
    recursive: false,
    requestOptions: { workspaceSurface: "browser" as const },
    searchScope: "prefix" as const,
    showDeletedObjects: false,
    sortBy: "name" as const,
    sortDirection: "asc" as const,
    sortId: "name-asc",
    storageFilter: "all",
    typeFilter: "all" as const,
    updateBucketAccessEntry: vi.fn(),
  };
}

describe("useBrowserObjectListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getBucketVersioning.mockResolvedValue({
      status: "Disabled",
      enabled: false,
    });
    apiMocks.listObjectVersions.mockResolvedValue({
      versions: [],
      delete_markers: [],
      common_prefixes: [],
      is_truncated: false,
      next_key_marker: null,
      next_version_id_marker: null,
    });
  });

  it("loads the current prefix and appends the next object page", async () => {
    apiMocks.listBrowserObjects.mockImplementation(
      (_accountId: string, _bucketName: string, options?: { continuationToken?: string }) =>
        Promise.resolve(
          options?.continuationToken === "page-2"
            ? objectPage([object("second.txt")])
            : objectPage([object("first.txt")], {
                nextToken: "page-2",
                prefixes: ["docs/"],
              }),
        ),
    );
    const options = createOptions();
    const { result } = renderHook(() => useBrowserObjectListing(options));

    await waitFor(() => {
      expect(result.current.objects.map((entry) => entry.key)).toEqual([
        "first.txt",
      ]);
      expect(result.current.objectsLoading).toBe(false);
    });
    expect(result.current.prefixes).toEqual(["docs/"]);
    expect(result.current.objectsNextToken).toBe("page-2");

    await act(async () => {
      await result.current.loadObjects({
        append: true,
        continuationToken: "page-2",
      });
    });

    expect(result.current.objects.map((entry) => entry.key)).toEqual([
      "first.txt",
      "second.txt",
    ]);
    expect(result.current.prefixes).toEqual(["docs/"]);
    expect(result.current.objectsIsTruncated).toBe(false);
    expect(apiMocks.listBrowserObjects).toHaveBeenLastCalledWith(
      "account-a",
      "bucket-a",
      expect.objectContaining({
        continuationToken: "page-2",
        workspaceSurface: "browser",
      }),
    );
  });

  it("ignores a response from the previous account even when abort is ignored", async () => {
    const accountARequest = deferred<ListBrowserObjectsResponse>();
    apiMocks.listBrowserObjects.mockImplementation((accountId: string) =>
      accountId === "account-a"
        ? accountARequest.promise
        : Promise.resolve(objectPage([object("account-b.txt")])),
    );
    const options = createOptions();
    const { result, rerender } = renderHook(
      ({ accountId }) =>
        useBrowserObjectListing({
          ...options,
          accountId,
        }),
      { initialProps: { accountId: "account-a" } },
    );

    await waitFor(() => {
      expect(apiMocks.listBrowserObjects).toHaveBeenCalledWith(
        "account-a",
        "bucket-a",
        expect.any(Object),
      );
    });
    rerender({ accountId: "account-b" });
    await waitFor(() => {
      expect(result.current.objects.map((entry) => entry.key)).toEqual([
        "account-b.txt",
      ]);
      expect(result.current.objectsLoading).toBe(false);
    });

    await act(async () => {
      accountARequest.resolve(objectPage([object("account-a.txt")]));
      await accountARequest.promise;
    });

    expect(result.current.objects.map((entry) => entry.key)).toEqual([
      "account-b.txt",
    ]);
  });

  it("lists latest delete markers when bucket versioning is active", async () => {
    apiMocks.getBucketVersioning.mockResolvedValue({
      status: "Enabled",
      enabled: true,
    });
    apiMocks.listBrowserObjects.mockResolvedValue(
      objectPage([object("active.txt")]),
    );
    apiMocks.listObjectVersions.mockResolvedValue({
      versions: [],
      delete_markers: [
        {
          key: "deleted.txt",
          version_id: "delete-v1",
          is_latest: true,
          is_delete_marker: true,
          last_modified: "2026-08-26T11:00:00Z",
        },
        {
          key: "active.txt",
          version_id: "delete-old",
          is_latest: true,
          is_delete_marker: true,
        },
      ],
      common_prefixes: ["removed-folder/"],
      is_truncated: false,
      next_key_marker: null,
      next_version_id_marker: null,
    });
    const options = {
      ...createOptions(),
      showDeletedObjects: true,
    };
    const { result } = renderHook(() => useBrowserObjectListing(options));

    await waitFor(() => {
      expect(result.current.isVersioningEnabled).toBe(true);
    });
    await act(async () => {
      await result.current.loadObjects({ forceRefresh: true });
    });

    expect(result.current.deletedObjects).toEqual([
      {
        key: "deleted.txt",
        size: 0,
        last_modified: "2026-08-26T11:00:00Z",
        etag: null,
        storage_class: null,
        is_delete_marker: true,
        version_id: "delete-v1",
      },
    ]);
    expect(result.current.deletedPrefixes).toEqual(["removed-folder/"]);
    expect(apiMocks.listObjectVersions).toHaveBeenCalledWith(
      "account-a",
      "bucket-a",
      expect.objectContaining({
        delimiter: "/",
        prefix: "",
        requestOptions: { workspaceSurface: "browser" },
      }),
    );
  });
});

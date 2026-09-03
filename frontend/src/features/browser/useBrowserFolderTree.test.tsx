import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListBrowserObjectsResponse } from "../../api/browserContracts";
import { findTreeNodeByPrefix } from "./browserUtils";
import type { TreeNode } from "./browserTypes";
import { useBrowserFolderTree } from "./useBrowserFolderTree";

const apiMocks = vi.hoisted(() => ({
  listBrowserObjects: vi.fn(),
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

function prefixPage(
  prefixes: string[],
  nextToken: string | null = null,
): ListBrowserObjectsResponse {
  return {
    prefix: "",
    objects: [],
    prefixes,
    is_truncated: Boolean(nextToken),
    next_continuation_token: nextToken,
  };
}

function createOptions() {
  return {
    accountId: "account-a",
    accountSwitchInFlight: false,
    bucketName: "bucket-a",
    currentBucketUnavailable: false,
    enabled: true,
    onWarning: vi.fn(),
    prefix: "",
    requestOptions: { workspaceSurface: "browser" as const },
  };
}

function findNode(rootNode: TreeNode | null, prefix: string) {
  return rootNode ? findTreeNodeByPrefix([rootNode], prefix) : null;
}

describe("useBrowserFolderTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects, deduplicates, and sorts paginated root prefixes", async () => {
    apiMocks.listBrowserObjects.mockImplementation(
      (_accountId: string, _bucketName: string, options?: { continuationToken?: string }) =>
        Promise.resolve(
          options?.continuationToken === "page-2"
            ? prefixPage(["docs/", "archive/"])
            : prefixPage(["photos/", "docs/"], "page-2"),
        ),
    );
    const options = createOptions();
    const { result } = renderHook(() => useBrowserFolderTree(options));

    await waitFor(() => {
      expect(result.current.treeRootNode?.isLoaded).toBe(true);
    });

    expect(
      result.current.treeRootNode?.children.map((node) => node.prefix),
    ).toEqual(["archive/", "docs/", "photos/"]);
    expect(apiMocks.listBrowserObjects).toHaveBeenCalledTimes(2);
    expect(apiMocks.listBrowserObjects).toHaveBeenLastCalledWith(
      "account-a",
      "bucket-a",
      expect.objectContaining({
        continuationToken: "page-2",
        prefix: "",
        signal: expect.any(AbortSignal),
        workspaceSurface: "browser",
      }),
    );
  });

  it("loads and expands every segment of the active prefix", async () => {
    apiMocks.listBrowserObjects.mockImplementation(
      (_accountId: string, _bucketName: string, options?: { prefix?: string }) => {
        if (options?.prefix === "docs/") {
          return Promise.resolve(prefixPage(["docs/reports/"]));
        }
        return Promise.resolve(
          options?.prefix === "docs/reports/"
            ? prefixPage([])
            : prefixPage(["docs/"]),
        );
      },
    );
    const options = {
      ...createOptions(),
      prefix: "docs/reports/",
    };
    const { result } = renderHook(() => useBrowserFolderTree(options));

    await waitFor(() => {
      expect(
        findNode(result.current.treeRootNode, "docs/reports/")?.isLoaded,
      ).toBe(true);
    });

    expect(result.current.treeRootNode?.isExpanded).toBe(true);
    expect(
      findNode(result.current.treeRootNode, "docs/")?.isExpanded,
    ).toBe(true);
    expect(
      findNode(result.current.treeRootNode, "docs/reports/")?.isExpanded,
    ).toBe(true);
  });

  it("ignores an old bucket child response even when abort is ignored", async () => {
    const oldChildRequest = deferred<ListBrowserObjectsResponse>();
    apiMocks.listBrowserObjects.mockImplementation(
      (_accountId: string, bucketName: string, options?: { prefix?: string }) => {
        if (bucketName === "bucket-a" && options?.prefix === "shared/") {
          return oldChildRequest.promise;
        }
        if (bucketName === "bucket-b" && options?.prefix === "shared/") {
          return Promise.resolve(prefixPage(["shared/new/"]));
        }
        return Promise.resolve(prefixPage(["shared/"]));
      },
    );
    const options = createOptions();
    const { result, rerender } = renderHook(
      ({ bucketName }) =>
        useBrowserFolderTree({
          ...options,
          bucketName,
        }),
      { initialProps: { bucketName: "bucket-a" } },
    );

    await waitFor(() => {
      expect(result.current.treeRootNode?.children[0]?.prefix).toBe("shared/");
    });
    act(() => {
      void result.current.loadTreeChildren("shared/");
    });
    await waitFor(() => {
      expect(
        findNode(result.current.treeRootNode, "shared/")?.isLoading,
      ).toBe(true);
    });

    rerender({ bucketName: "bucket-b" });
    await waitFor(() => {
      expect(result.current.treeRootNode?.name).toBe("bucket-b");
      expect(result.current.treeRootNode?.isLoaded).toBe(true);
    });
    await act(async () => {
      await result.current.loadTreeChildren("shared/");
    });
    expect(
      findNode(result.current.treeRootNode, "shared/")?.children.map(
        (node) => node.prefix,
      ),
    ).toEqual(["shared/new/"]);

    await act(async () => {
      oldChildRequest.resolve(prefixPage(["shared/old/"]));
      await oldChildRequest.promise;
    });

    expect(
      findNode(result.current.treeRootNode, "shared/")?.children.map(
        (node) => node.prefix,
      ),
    ).toEqual(["shared/new/"]);
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserBucketAccess } from "./useBrowserBucketAccess";

const apiMocks = vi.hoisted(() => ({ listBrowserObjects: vi.fn() }));

vi.mock("../../api/browserObjects", async () => ({
  ...(await vi.importActual<typeof import("../../api/browserObjects")>(
    "../../api/browserObjects",
  )),
  ...apiMocks,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function createOptions() {
  return {
    accountId: "account-a",
    activeBucketName: "current",
    contextKey: "browser:account-a",
    enabled: true,
    requestOptions: { workspaceSurface: "browser" as const },
  };
}

function StrictModeWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

describe("useBrowserBucketAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("probes a bucket once and records its availability", async () => {
    apiMocks.listBrowserObjects.mockResolvedValue({});
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBucketAccess(options), {
      wrapper: StrictModeWrapper,
    });

    act(() => result.current.scheduleBucketAccessProbe("archive"));

    await waitFor(() => {
      expect(result.current.accessByName.archive?.status).toBe("available");
    });
    expect(apiMocks.listBrowserObjects).toHaveBeenCalledOnce();
    expect(apiMocks.listBrowserObjects).toHaveBeenCalledWith(
      "account-a",
      "archive",
      expect.objectContaining({
        maxKeys: 1,
        workspaceSurface: "browser",
      }),
    );

    act(() => result.current.scheduleBucketAccessProbe("archive"));
    expect(apiMocks.listBrowserObjects).toHaveBeenCalledOnce();
  });

  it("keeps cached access results isolated by execution context", async () => {
    apiMocks.listBrowserObjects.mockImplementation(
      (accountId: string) =>
        accountId === "account-a"
          ? Promise.resolve({})
          : Promise.reject(new Error("AccessDenied for this bucket")),
    );
    const { result, rerender } = renderHook(
      ({ accountId, contextKey }) =>
        useBrowserBucketAccess({
          ...createOptions(),
          accountId,
          contextKey,
        }),
      {
        initialProps: {
          accountId: "account-a",
          contextKey: "browser:account-a",
        },
      },
    );

    act(() => result.current.scheduleBucketAccessProbe("shared-name"));
    await waitFor(() => {
      expect(result.current.accessByName["shared-name"]?.status).toBe(
        "available",
      );
    });
    const updateAccountAEntry = result.current.updateBucketAccessEntry;

    rerender({
      accountId: "account-b",
      contextKey: "browser:account-b",
    });
    expect(result.current.accessByName["shared-name"]).toBeUndefined();
    act(() => {
      updateAccountAEntry("account-a-only", {
        status: "available",
        detail: null,
      });
    });
    expect(result.current.accessByName["account-a-only"]).toBeUndefined();
    act(() => result.current.scheduleBucketAccessProbe("shared-name"));
    await waitFor(() => {
      expect(result.current.accessByName["shared-name"]?.status).toBe(
        "unavailable",
      );
    });

    rerender({
      accountId: "account-a",
      contextKey: "browser:account-a",
    });
    expect(result.current.accessByName["shared-name"]?.status).toBe(
      "available",
    );
  });

  it("does not let a stale completion free capacity in the new context", async () => {
    const requests = new Map<
      string,
      ReturnType<typeof deferred<Record<string, never>>>
    >();
    apiMocks.listBrowserObjects.mockImplementation(
      (accountId: string, bucketName: string) => {
        const request = deferred<Record<string, never>>();
        requests.set(`${accountId}:${bucketName}`, request);
        return request.promise;
      },
    );
    const { result, rerender } = renderHook(
      ({ accountId, contextKey }) =>
        useBrowserBucketAccess({
          ...createOptions(),
          accountId,
          contextKey,
        }),
      {
        initialProps: {
          accountId: "account-a",
          contextKey: "browser:account-a",
        },
      },
    );

    act(() => result.current.scheduleBucketAccessProbe("shared-name"));
    await waitFor(() => {
      expect(requests.has("account-a:shared-name")).toBe(true);
    });
    const staleRequest = requests.get("account-a:shared-name");

    rerender({
      accountId: "account-b",
      contextKey: "browser:account-b",
    });
    act(() => result.current.scheduleBucketAccessProbe("shared-name"));
    await waitFor(() => {
      expect(requests.has("account-b:shared-name")).toBe(true);
    });

    await act(async () => {
      staleRequest?.resolve({});
      await staleRequest?.promise;
    });
    act(() => {
      result.current.scheduleBucketAccessProbe("bucket-2");
      result.current.scheduleBucketAccessProbe("bucket-3");
      result.current.scheduleBucketAccessProbe("bucket-4");
      result.current.scheduleBucketAccessProbe("bucket-5");
    });

    await waitFor(() => {
      expect(requests.has("account-b:bucket-4")).toBe(true);
    });
    expect(requests.has("account-b:bucket-5")).toBe(false);

    const completedRequest = requests.get("account-b:bucket-2");
    await act(async () => {
      completedRequest?.resolve({});
      await completedRequest?.promise;
    });
    await waitFor(() => {
      expect(requests.has("account-b:bucket-5")).toBe(true);
    });
  });
});

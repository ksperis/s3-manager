import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BucketInspectorData } from "./browserBucketInspectorModel";
import { useBrowserBucketInspector } from "./useBrowserBucketInspector";

const modelMocks = vi.hoisted(() => ({
  fetchBucketInspectorData: vi.fn(),
}));

vi.mock("./browserBucketInspectorModel", async () => ({
  ...(await vi.importActual<typeof import("./browserBucketInspectorModel")>(
    "./browserBucketInspectorModel",
  )),
  ...modelMocks,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function inspectorData(
  usedBytes: number,
  versioningState = "Enabled",
): BucketInspectorData {
  return {
    creation_date: "2026-08-26T10:00:00Z",
    used_bytes: usedBytes,
    object_count: 3,
    quota_max_size_bytes: null,
    quota_max_objects: null,
    features: {
      versioning: {
        state: versioningState,
        tone: versioningState === "Enabled" ? "active" : "inactive",
      },
    },
  };
}

function createOptions() {
  return {
    accountId: "account-a",
    bucketName: "shared-bucket",
    enabled: true,
    includeStaticWebsite: true,
    includeUsage: true,
  };
}

describe("useBrowserBucketInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("caches inspector data for the current execution scope", async () => {
    modelMocks.fetchBucketInspectorData.mockResolvedValue(inspectorData(128));
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBucketInspector(options));

    await act(async () => {
      await result.current.load();
      await result.current.load();
    });

    expect(modelMocks.fetchBucketInspectorData).toHaveBeenCalledOnce();
    expect(result.current.data?.used_bytes).toBe(128);
    expect(result.current.features).toEqual([
      {
        key: "versioning",
        label: "Versioning",
        state: "Enabled",
        tone: "active",
      },
    ]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not reuse a same-name bucket cache across accounts", async () => {
    modelMocks.fetchBucketInspectorData.mockImplementation(
      ({ accountId }: { accountId: string }) =>
        Promise.resolve(
          inspectorData(accountId === "account-a" ? 128 : 256),
        ),
    );
    const options = createOptions();
    const { result, rerender } = renderHook(
      ({ accountId }) =>
        useBrowserBucketInspector({
          ...options,
          accountId,
        }),
      { initialProps: { accountId: "account-a" } },
    );

    await act(async () => {
      await result.current.load();
    });
    expect(result.current.data?.used_bytes).toBe(128);

    rerender({ accountId: "account-b" });
    expect(result.current.data).toBeNull();
    await act(async () => {
      await result.current.load();
    });

    expect(result.current.data?.used_bytes).toBe(256);
    expect(modelMocks.fetchBucketInspectorData).toHaveBeenCalledTimes(2);
  });

  it("ignores a response from the previous account", async () => {
    const accountARequest = deferred<BucketInspectorData>();
    modelMocks.fetchBucketInspectorData.mockImplementation(
      ({ accountId }: { accountId: string }) =>
        accountId === "account-a"
          ? accountARequest.promise
          : Promise.resolve(inspectorData(256, "Disabled")),
    );
    const options = createOptions();
    const { result, rerender } = renderHook(
      ({ accountId }) =>
        useBrowserBucketInspector({
          ...options,
          accountId,
        }),
      { initialProps: { accountId: "account-a" } },
    );

    act(() => {
      void result.current.load();
    });
    expect(result.current.loading).toBe(true);
    rerender({ accountId: "account-b" });
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.data?.used_bytes).toBe(256);

    await act(async () => {
      accountARequest.resolve(inspectorData(128));
      await accountARequest.promise;
    });

    expect(result.current.data?.used_bytes).toBe(256);
    expect(result.current.features[0]?.state).toBe("Disabled");
    expect(result.current.loading).toBe(false);
  });
});

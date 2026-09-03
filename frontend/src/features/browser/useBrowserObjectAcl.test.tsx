import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserObjectAcl } from "./useBrowserObjectAcl";

const apiMocks = vi.hoisted(() => ({
  updateObjectAcl: vi.fn(),
}));

vi.mock("../../api/browser", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browser")>(
      "../../api/browser",
    );
  return {
    ...actual,
    updateObjectAcl: (...args: unknown[]) => apiMocks.updateObjectAcl(...args),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useBrowserObjectAcl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.updateObjectAcl.mockResolvedValue(undefined);
  });

  it("updates the selected canned ACL for the current object version", async () => {
    const { result } = renderHook(() =>
      useBrowserObjectAcl({
        accountId: "acc-1",
        bucketName: "bucket-a",
        objectKey: "docs/report.txt",
        requestOptions: { workspaceSurface: "manager" },
        versionId: "version-2",
      }),
    );

    act(() => result.current.setValue("public-read"));
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });

    expect(apiMocks.updateObjectAcl).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        key: "docs/report.txt",
        acl: "public-read",
        version_id: "version-2",
      },
      undefined,
      { workspaceSurface: "manager" },
    );
    expect(result.current.saving).toBe(false);
  });

  it("resets the ACL choice when the selected object changes", () => {
    const { result, rerender } = renderHook(
      ({ objectKey }) =>
        useBrowserObjectAcl({
          accountId: "acc-1",
          bucketName: "bucket-a",
          objectKey,
        }),
      { initialProps: { objectKey: "docs/old.txt" } },
    );

    act(() => result.current.setValue("authenticated-read"));
    rerender({ objectKey: "docs/current.txt" });

    expect(result.current.value).toBe("private");
  });

  it("discards an ACL response for a previously selected object", async () => {
    const pendingUpdate = deferred<void>();
    apiMocks.updateObjectAcl.mockReturnValueOnce(pendingUpdate.promise);
    const { result, rerender } = renderHook(
      ({ objectKey }) =>
        useBrowserObjectAcl({
          accountId: "acc-1",
          bucketName: "bucket-a",
          objectKey,
        }),
      { initialProps: { objectKey: "docs/old.txt" } },
    );

    let savePromise!: ReturnType<typeof result.current.save>;
    act(() => {
      savePromise = result.current.save();
    });
    expect(result.current.saving).toBe(true);
    rerender({ objectKey: "docs/current.txt" });
    expect(result.current.saving).toBe(false);

    await act(async () => {
      pendingUpdate.resolve();
      expect(await savePromise).toBe(false);
    });
  });
});

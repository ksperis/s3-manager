import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketObjectsController } from "../useBucketObjectsController";

const apiMocks = vi.hoisted(() => ({
  listCephAdminBucketObjects: vi.fn(),
  listObjects: vi.fn(),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  listCephAdminBucketObjects: (...args: unknown[]) =>
    apiMocks.listCephAdminBucketObjects(...args),
}));

vi.mock("../../../../api/objects", () => ({
  listObjects: (...args: unknown[]) => apiMocks.listObjects(...args),
}));

function renderObjects(
  overrides: Partial<Parameters<typeof useBucketObjectsController>[0]> = {},
) {
  return renderHook(() =>
    useBucketObjectsController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const emptyListing = {
  is_truncated: false,
  objects: [],
  prefix: "",
  prefixes: [],
};

describe("useBucketObjectsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads Manager rows and derives prefix navigation", async () => {
    apiMocks.listObjects
      .mockResolvedValueOnce({
        ...emptyListing,
        objects: [{ key: "summary.csv", size: 2048 }],
        prefixes: ["archive/"],
      })
      .mockResolvedValueOnce({
        ...emptyListing,
        objects: [{ key: "archive/report.csv", size: 1024 }],
        prefix: "archive/",
      });
    const { result } = renderObjects();

    await act(async () => result.current.refresh());

    expect(apiMocks.listObjects).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      "",
    );
    expect(result.current.rows).toEqual([
      { key: "archive/", name: "archive/", type: "prefix" },
      {
        key: "summary.csv",
        name: "summary.csv",
        object: { key: "summary.csv", size: 2048 },
        type: "object",
      },
    ]);

    act(() => result.current.openPrefix("archive/"));
    expect(result.current.currentPrefix).toBe("archive/");
    expect(result.current.parentPrefix).toBe("");
    await act(async () => result.current.refresh());

    expect(apiMocks.listObjects).toHaveBeenLastCalledWith(
      "acc-1",
      "reports",
      "archive/",
    );
    expect(result.current.rows[0]).toMatchObject({
      key: "archive/report.csv",
      name: "report.csv",
      type: "object",
    });

    act(() => result.current.openPrefix("archive/2026/"));
    expect(result.current.parentPrefix).toBe("archive/");
  });

  it("loads objects through the selected Ceph Admin endpoint", async () => {
    apiMocks.listCephAdminBucketObjects.mockResolvedValue({
      ...emptyListing,
      objects: [{ key: "logs/app.log", size: 12, last_modified: null }],
      prefixes: ["logs/"],
    });
    const { result } = renderObjects({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.refresh());

    expect(apiMocks.listCephAdminBucketObjects).toHaveBeenCalledWith(
      7,
      "reports",
      "",
    );
    expect(result.current.rows[1]).toMatchObject({
      key: "logs/app.log",
      object: { last_modified: undefined },
      type: "object",
    });
  });

  it("clears rows and exposes listing failures", async () => {
    apiMocks.listObjects
      .mockResolvedValueOnce({
        ...emptyListing,
        objects: [{ key: "old.txt", size: 1 }],
      })
      .mockRejectedValueOnce(new Error("listing failed"));
    const { result } = renderObjects();

    await act(async () => result.current.refresh());
    expect(result.current.rows).toHaveLength(1);

    await act(async () => result.current.refresh());

    expect(result.current.rows).toEqual([]);
    expect(result.current.prefixes).toEqual([]);
    expect(result.current.error).toBe("listing failed");
  });

  it("ignores a response from the previous bucket context", async () => {
    let resolveOldListing!: (value: typeof emptyListing) => void;
    const oldListing = new Promise<typeof emptyListing>((resolve) => {
      resolveOldListing = resolve;
    });
    apiMocks.listObjects
      .mockReturnValueOnce(oldListing)
      .mockResolvedValueOnce({
        ...emptyListing,
        objects: [{ key: "new.txt", size: 2 }],
      });
    const initial = {
      accountId: "acc-1",
      bucketName: "old-bucket",
    };
    const { result, rerender } = renderHook(
      (props: typeof initial) =>
        useBucketObjectsController({
          ...props,
          cephAdmin: false,
          enabled: true,
          endpointId: null,
        }),
      { initialProps: initial },
    );

    let pendingOldLoad!: Promise<void>;
    act(() => {
      pendingOldLoad = result.current.refresh();
    });
    rerender({ accountId: "acc-2", bucketName: "new-bucket" });
    await act(async () => result.current.refresh());
    expect(result.current.rows[0]).toMatchObject({ key: "new.txt" });

    await act(async () => {
      resolveOldListing({
        ...emptyListing,
        objects: [{ key: "old.txt", size: 1 }],
      });
      await pendingOldLoad;
    });

    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ key: "new.txt" });
    expect(result.current.loading).toBe(false);
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const disabled = renderObjects({ enabled: false });
    const missingEndpoint = renderObjects({
      cephAdmin: true,
      endpointId: null,
    });

    await act(async () => disabled.result.current.refresh());
    await act(async () => missingEndpoint.result.current.refresh());

    expect(apiMocks.listObjects).not.toHaveBeenCalled();
    expect(apiMocks.listCephAdminBucketObjects).not.toHaveBeenCalled();
    expect(disabled.result.current.rows).toEqual([]);
    expect(missingEndpoint.result.current.rows).toEqual([]);
  });
});

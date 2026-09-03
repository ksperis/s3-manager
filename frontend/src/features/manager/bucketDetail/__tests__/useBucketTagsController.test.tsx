import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketTagsController } from "../useBucketTagsController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketTags: vi.fn(),
  deleteCephAdminBucketTags: vi.fn(),
  getBucketTags: vi.fn(),
  getCephAdminBucketTags: vi.fn(),
  putBucketTags: vi.fn(),
  putCephAdminBucketTags: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  deleteBucketTags: (...args: unknown[]) => apiMocks.deleteBucketTags(...args),
  getBucketTags: (...args: unknown[]) => apiMocks.getBucketTags(...args),
  putBucketTags: (...args: unknown[]) => apiMocks.putBucketTags(...args),
}));

vi.mock("../../../../api/cephAdminBuckets", () => ({
  deleteCephAdminBucketTags: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketTags(...args),
  getCephAdminBucketTags: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketTags(...args),
  putCephAdminBucketTags: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketTags(...args),
}));

function renderTags(
  overrides: Partial<Parameters<typeof useBucketTagsController>[0]> = {},
) {
  return renderHook(() =>
    useBucketTagsController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketTagsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, edits, and saves normalized Manager bucket tags", async () => {
    apiMocks.getBucketTags.mockResolvedValue({
      tags: [
        { key: " env ", value: " prod " },
        { key: "", value: "ignored" },
      ],
    });
    apiMocks.putBucketTags.mockResolvedValue(undefined);
    const { result } = renderTags();

    await act(async () => result.current.load());
    expect(apiMocks.getBucketTags).toHaveBeenCalledWith("acc-1", "reports");
    expect(result.current.tags).toHaveLength(1);
    expect(result.current.tags[0]).toMatchObject({
      key: "env",
      value: " prod ",
    });
    expect(result.current.configured).toBe(true);
    expect(result.current.dirty).toBe(false);

    act(() =>
      result.current.update(result.current.tags[0].uiId, {
        value: " staging ",
      }),
    );
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());

    expect(apiMocks.putBucketTags).toHaveBeenCalledWith("acc-1", "reports", [
      { key: "env", value: "staging" },
    ]);
    expect(result.current.status).toBe("Bucket tags updated.");
    expect(result.current.dirty).toBe(false);
  });

  it("rejects duplicate tag keys before calling the API", async () => {
    const { result } = renderTags();
    act(() => {
      result.current.add();
      result.current.add();
    });
    act(() => {
      result.current.update(result.current.tags[0].uiId, {
        key: "environment",
        value: "prod",
      });
      result.current.update(result.current.tags[1].uiId, {
        key: "environment",
        value: "staging",
      });
    });

    await act(async () => result.current.save());

    expect(result.current.error).toBe("Duplicate tag key: environment");
    expect(apiMocks.putBucketTags).not.toHaveBeenCalled();
  });

  it("deletes the Manager tag set when saving an empty draft", async () => {
    apiMocks.deleteBucketTags.mockResolvedValue(undefined);
    const { result } = renderTags();

    await act(async () => result.current.save());

    expect(apiMocks.deleteBucketTags).toHaveBeenCalledWith("acc-1", "reports");
    expect(result.current.status).toBe("Bucket tags cleared.");
  });

  it("loads and clears tags through the Ceph Admin endpoint", async () => {
    apiMocks.getCephAdminBucketTags.mockResolvedValue({
      tags: [{ key: "team", value: "storage" }],
    });
    apiMocks.deleteCephAdminBucketTags.mockResolvedValue(undefined);
    const { result } = renderTags({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    await act(async () => result.current.clear());

    expect(apiMocks.getCephAdminBucketTags).toHaveBeenCalledWith(7, "reports");
    expect(apiMocks.deleteCephAdminBucketTags).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(result.current.tags).toEqual([]);
    expect(result.current.configured).toBe(false);
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const { result } = renderTags({ enabled: false });

    await act(async () => result.current.load());
    await act(async () => result.current.save());
    await act(async () => result.current.clear());

    expect(apiMocks.getBucketTags).not.toHaveBeenCalled();
    expect(apiMocks.putBucketTags).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketTags).not.toHaveBeenCalled();
  });
});

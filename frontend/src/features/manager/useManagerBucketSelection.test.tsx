import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket } from "../../api/bucketContracts";
import type { ExecutionContext } from "../../api/executionContexts";
import { useManagerBucketSelection } from "./useManagerBucketSelection";

const listBucketsMock = vi.fn();

const primaryContext = {
  kind: "account",
  id: "context-1",
  display_name: "Primary account",
  tags: [],
  endpoint_tags: [],
  endpoint_name: "Primary endpoint",
  endpoint_is_default: true,
  endpoint_url: "https://primary.example.test",
  storage_endpoint_capabilities: {},
  capabilities: {
    can_manage_iam: true,
    sts_capable: true,
    admin_api_capable: true,
  },
} satisfies ExecutionContext;

const secondaryContext = {
  ...primaryContext,
  id: "context-2",
  display_name: "Secondary account",
} satisfies ExecutionContext;

let accountContext = {
  accounts: [primaryContext, secondaryContext],
  selectedS3AccountId: primaryContext.id as string | null,
  requiresS3AccountSelection: true,
};

vi.mock("../../api/buckets", () => ({
  listBuckets: (...args: unknown[]) => listBucketsMock(...args),
}));

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => accountContext,
}));

describe("useManagerBucketSelection", () => {
  beforeEach(() => {
    listBucketsMock.mockReset();
    accountContext = {
      accounts: [primaryContext, secondaryContext],
      selectedS3AccountId: primaryContext.id,
      requiresS3AccountSelection: true,
    };
  });

  it("loads, sorts, filters, and selects bucket targets for the active context", async () => {
    listBucketsMock.mockResolvedValue([
      { name: "zeta" },
      { name: "alpha" },
    ] satisfies Bucket[]);
    const { result } = renderHook(() => useManagerBucketSelection());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listBucketsMock).toHaveBeenCalledWith(primaryContext.id, { with_stats: false });
    expect(result.current.filteredBuckets.map((bucket) => bucket.name)).toEqual(["alpha", "zeta"]);

    act(() => result.current.setFilter("ALP"));
    expect(result.current.filteredBuckets.map((bucket) => bucket.name)).toEqual(["alpha"]);

    act(() => result.current.selectAllFiltered());
    expect([...result.current.selectedBuckets]).toEqual(["alpha"]);
    expect(result.current.selectedBucketList).toEqual(["alpha"]);
    expect(result.current.selectedTargets).toEqual([
      {
        bucketName: "alpha",
        contextId: primaryContext.id,
        contextName: primaryContext.display_name,
      },
    ]);

    act(() => result.current.clearSelection());
    expect(result.current.selectedBuckets.size).toBe(0);
  });

  it("prunes unavailable selections when the execution context changes", async () => {
    listBucketsMock
      .mockResolvedValueOnce([{ name: "alpha" }, { name: "shared" }] satisfies Bucket[])
      .mockResolvedValueOnce([{ name: "shared" }, { name: "zeta" }] satisfies Bucket[]);
    const { result, rerender } = renderHook(() => useManagerBucketSelection());

    await waitFor(() => expect(result.current.filteredBuckets).toHaveLength(2));
    act(() => {
      result.current.toggleBucket("alpha");
      result.current.toggleBucket("shared");
    });

    accountContext = {
      ...accountContext,
      selectedS3AccountId: secondaryContext.id,
    };
    rerender();

    await waitFor(() => expect(listBucketsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect([...result.current.selectedBuckets]).toEqual(["shared"]));
    expect(result.current.selectedTargets[0]).toMatchObject({
      contextId: secondaryContext.id,
      contextName: secondaryContext.display_name,
    });
  });

  it("clears buckets and reports the canonical load error", async () => {
    listBucketsMock.mockRejectedValue(new Error("network failure"));
    const { result, rerender } = renderHook(() => useManagerBucketSelection());

    await waitFor(() => expect(result.current.error).toBe("network failure"));
    expect(result.current.filteredBuckets).toEqual([]);

    accountContext = {
      ...accountContext,
      selectedS3AccountId: null,
    };
    rerender();
    expect(result.current.filteredBuckets).toEqual([]);
    expect(result.current.selectedBuckets.size).toBe(0);
  });
});

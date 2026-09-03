import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useManagerIamCollection } from "./useManagerIamCollection";

describe("useManagerIamCollection", () => {
  it("loads items and clears an earlier error", async () => {
    const listItems = vi
      .fn<(accountId: string) => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockResolvedValueOnce(["one", "two"]);
    const { result } = renderHook(() => useManagerIamCollection(listItems));

    await act(async () => result.current.load("account-1"));
    expect(result.current).toMatchObject({
      error: "first failure",
      items: [],
      loading: false,
    });

    await act(async () => result.current.load("account-1"));
    expect(result.current).toMatchObject({
      error: null,
      items: ["one", "two"],
      loading: false,
    });
    expect(listItems).toHaveBeenCalledTimes(2);
  });

  it("loads related items without changing primary loading state", async () => {
    const listItems = vi.fn<(accountId: string) => Promise<string[]>>().mockResolvedValue([]);
    const listRelatedItems = vi
      .fn<(accountId: string) => Promise<number[]>>()
      .mockResolvedValueOnce([1, 2])
      .mockRejectedValueOnce(new Error("related failure"));
    const setRelatedItems = vi.fn();
    const { result } = renderHook(() => useManagerIamCollection(listItems));

    await act(async () =>
      result.current.loadRelated("account-1", listRelatedItems, setRelatedItems),
    );
    expect(setRelatedItems).toHaveBeenCalledWith([1, 2]);
    expect(result.current).toMatchObject({ error: null, loading: false });

    await act(async () =>
      result.current.loadRelated("account-1", listRelatedItems, setRelatedItems),
    );
    expect(result.current).toMatchObject({
      error: "related failure",
      loading: false,
    });
  });
});

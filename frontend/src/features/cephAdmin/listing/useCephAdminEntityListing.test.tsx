import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCephAdminEntityListing } from "./useCephAdminEntityListing";

type TestEntity = {
  id: string;
  label: string;
  detail?: string;
};

type ListingResponse = {
  items: TestEntity[];
  total: number;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const defaultOptions = {
  endpointId: 7,
  page: 1,
  pageSize: 25,
  search: "",
  advancedFilter: undefined,
  sortBy: "id",
  sortDirection: "asc" as const,
  includes: [] as string[],
  reloadNonce: 0,
  entityKey: (entity: TestEntity) => entity.id,
};

describe("useCephAdminEntityListing", () => {
  it("loads base rows and merges requested detail enrichment by entity key", async () => {
    const listEntities = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ id: "one", label: "One enriched", detail: "ready" }],
        total: 2,
      });
    const streamEntities = vi.fn();

    const { result } = renderHook(() =>
      useCephAdminEntityListing<TestEntity>({
        ...defaultOptions,
        includes: ["detail"],
        listEntities,
        streamEntities,
      })
    );

    await waitFor(() => expect(listEntities).toHaveBeenCalledTimes(2));
    expect(result.current.loadingDetails).toBe(false);
    expect(result.current.items).toEqual([
      { id: "one", label: "One enriched", detail: "ready" },
      { id: "two", label: "Two" },
    ]);
    expect(result.current.total).toBe(2);
    expect(listEntities).toHaveBeenNthCalledWith(
      2,
      7,
      expect.objectContaining({ include: ["detail"] }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(streamEntities).not.toHaveBeenCalled();
  });

  it("ignores a stale response after the listing parameters change", async () => {
    const firstRequest = deferred<ListingResponse>();
    const listEntities = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce({ items: [{ id: "new", label: "New" }], total: 1 });
    const streamEntities = vi.fn();

    const { result, rerender } = renderHook(
      ({ search }) =>
        useCephAdminEntityListing<TestEntity>({
          ...defaultOptions,
          search,
          listEntities,
          streamEntities,
        }),
      { initialProps: { search: "old" } }
    );

    rerender({ search: "new" });
    await waitFor(() => expect(result.current.items).toEqual([{ id: "new", label: "New" }]));

    await act(async () => {
      firstRequest.resolve({ items: [{ id: "old", label: "Old" }], total: 1 });
      await firstRequest.promise;
    });

    expect(result.current.items).toEqual([{ id: "new", label: "New" }]);
  });

  it("falls back to the list endpoint when the advanced stream fails", async () => {
    const listEntities = vi.fn().mockResolvedValue({ items: [{ id: "fallback", label: "Fallback" }], total: 1 });
    const streamEntities = vi.fn().mockRejectedValue(new Error("stream unavailable"));

    const { result } = renderHook(() =>
      useCephAdminEntityListing<TestEntity>({
        ...defaultOptions,
        advancedFilter: '{"match":"all","rules":[]}',
        listEntities,
        streamEntities,
      })
    );

    await waitFor(() => expect(result.current.items).toEqual([{ id: "fallback", label: "Fallback" }]));
    expect(streamEntities).toHaveBeenCalledOnce();
    expect(listEntities).toHaveBeenCalledOnce();
    expect(result.current.advancedProgress.active).toBe(false);
  });

  it("updates a loaded entity without exposing the hook state setter", async () => {
    const listEntities = vi.fn().mockResolvedValue({ items: [{ id: "one", label: "One" }], total: 1 });
    const streamEntities = vi.fn();

    const { result } = renderHook(() =>
      useCephAdminEntityListing<TestEntity>({
        ...defaultOptions,
        listEntities,
        streamEntities,
      })
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => {
      result.current.updateEntity("one", (entity) => ({ ...entity, label: "Updated" }));
    });

    expect(result.current.items).toEqual([{ id: "one", label: "Updated" }]);
  });
});

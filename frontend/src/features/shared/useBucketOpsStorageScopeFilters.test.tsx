/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../../api/executionContexts";
import {
  defaultAdvancedFilter,
  type AdvancedFilterState,
} from "./bucketOpsAdvancedFilterModel";
import { useBucketOpsStorageScopeFilters } from "./useBucketOpsStorageScopeFilters";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createContext(
  id: string,
  displayName: string,
  endpointName: string,
  kind: ExecutionContext["kind"] = "account",
): ExecutionContext {
  return {
    kind,
    id,
    display_name: displayName,
    tags: [],
    endpoint_tags: [],
    endpoint_id: 1,
    endpoint_name: endpointName,
    endpoint_is_default: false,
    endpoint_url: `https://${endpointName.toLowerCase().replaceAll(" ", "-")}.test`,
    storage_endpoint_capabilities: {},
    capabilities: {
      can_manage_iam: false,
      sts_capable: false,
      admin_api_capable: false,
    },
  };
}

const contexts = [
  createContext("account:alpha", "Alpha account", "Endpoint A"),
  createContext(
    "connection:beta",
    "Beta connection",
    "Endpoint B",
    "connection",
  ),
];

const extractError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

describe("useBucketOpsStorageScopeFilters", () => {
  it("loads and projects Manager execution contexts for Storage Ops", async () => {
    const loadExecutionContexts = vi.fn(async () => contexts);
    const { result } = renderHook(() => {
      const [advancedDraft, setAdvancedDraft] = useState<AdvancedFilterState>({
        ...defaultAdvancedFilter,
        contextIds: ["account:alpha"],
        endpointNames: ["Endpoint A"],
      });
      return useBucketOpsStorageScopeFilters({
        advancedDraft,
        extractError,
        isStorageOps: true,
        loadExecutionContexts,
        setAdvancedDraft,
      });
    });

    await waitFor(() =>
      expect(result.current.storageOpsContextsLoading).toBe(false),
    );

    expect(loadExecutionContexts).toHaveBeenCalledWith(
      "manager",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      result.current.storageOpsContextItems.map((context) => context.id),
    ).toEqual(["account:alpha", "connection:beta"]);
    expect(
      result.current.storageOpsEndpointItems.map((endpoint) => endpoint.name),
    ).toEqual(["Endpoint A", "Endpoint B"]);
    expect(result.current.storageOpsContextLabelById.get("connection:beta")).toBe(
      "Beta connection",
    );
    expect(result.current.storageOpsContextSelectionSet).toEqual(
      new Set(["account:alpha"]),
    );
    expect(result.current.storageOpsEndpointSelectionSet).toEqual(
      new Set(["Endpoint A"]),
    );
    expect(result.current.storageOpsContextsError).toBeNull();
  });

  it("surfaces context catalogue failures", async () => {
    const loadExecutionContexts = vi.fn(async () => {
      throw new Error("catalogue unavailable");
    });
    const { result } = renderHook(() => {
      const [advancedDraft, setAdvancedDraft] = useState(defaultAdvancedFilter);
      return useBucketOpsStorageScopeFilters({
        advancedDraft,
        extractError,
        isStorageOps: true,
        loadExecutionContexts,
        setAdvancedDraft,
      });
    });

    await waitFor(() =>
      expect(result.current.storageOpsContextsError).toBe(
        "catalogue unavailable",
      ),
    );

    expect(result.current.storageOpsContextsLoading).toBe(false);
    expect(result.current.storageOpsContextItems).toEqual([]);
    expect(result.current.storageOpsEndpointItems).toEqual([]);
  });

  it("aborts and discards a catalogue request when Storage Ops is left", async () => {
    const deferred = createDeferred<ExecutionContext[]>();
    let requestSignal: AbortSignal | undefined;
    const loadExecutionContexts = vi.fn(
      async (
        _workspace?: "manager" | "browser",
        options?: { signal?: AbortSignal },
      ) => {
        requestSignal = options?.signal;
        return deferred.promise;
      },
    );
    const { result, rerender } = renderHook(
      ({ isStorageOps }) => {
        const [advancedDraft, setAdvancedDraft] = useState(defaultAdvancedFilter);
        return useBucketOpsStorageScopeFilters({
          advancedDraft,
          extractError,
          isStorageOps,
          loadExecutionContexts,
          setAdvancedDraft,
        });
      },
      { initialProps: { isStorageOps: true } },
    );

    expect(result.current.storageOpsContextsLoading).toBe(true);
    rerender({ isStorageOps: false });

    expect(requestSignal?.aborted).toBe(true);
    expect(result.current.storageOpsContextsLoading).toBe(false);

    await act(async () => {
      deferred.resolve(contexts);
      await deferred.promise;
    });

    expect(result.current.storageOpsContextItems).toEqual([]);
    expect(result.current.storageOpsContextsError).toBeNull();
  });

  it("does not load the catalogue outside Storage Ops", () => {
    const loadExecutionContexts = vi.fn(async () => contexts);
    const { result } = renderHook(() => {
      const [advancedDraft, setAdvancedDraft] = useState(defaultAdvancedFilter);
      return useBucketOpsStorageScopeFilters({
        advancedDraft,
        extractError,
        isStorageOps: false,
        loadExecutionContexts,
        setAdvancedDraft,
      });
    });

    expect(loadExecutionContexts).not.toHaveBeenCalled();
    expect(result.current.storageOpsContextsLoading).toBe(false);
    expect(result.current.storageOpsContextItems).toEqual([]);
  });

  it("owns filtered context and endpoint selection updates", async () => {
    const loadExecutionContexts = vi.fn(async () => contexts);
    const { result } = renderHook(() => {
      const [advancedDraft, setAdvancedDraft] = useState<AdvancedFilterState>({
        ...defaultAdvancedFilter,
        contextIds: ["account:alpha"],
        endpointNames: ["Endpoint A"],
      });
      const controller = useBucketOpsStorageScopeFilters({
        advancedDraft,
        extractError,
        isStorageOps: true,
        loadExecutionContexts,
        setAdvancedDraft,
      });
      return { advancedDraft, controller };
    });

    await waitFor(() =>
      expect(result.current.controller.storageOpsContextsLoading).toBe(false),
    );

    act(() => result.current.controller.setStorageOpsContextFilter("beta"));
    expect(
      result.current.controller.filteredStorageOpsContextItems.map(
        (context) => context.id,
      ),
    ).toEqual(["connection:beta"]);

    act(() => result.current.controller.selectFilteredStorageOpsContexts());
    expect(result.current.advancedDraft.contextIds).toEqual([
      "account:alpha",
      "connection:beta",
    ]);
    expect(
      result.current.controller.allFilteredStorageOpsContextsSelected,
    ).toBe(true);

    act(() => result.current.controller.deselectFilteredStorageOpsContexts());
    expect(result.current.advancedDraft.contextIds).toEqual(["account:alpha"]);
    act(() => result.current.controller.toggleAdvancedContextId("account:alpha"));
    expect(result.current.advancedDraft.contextIds).toEqual([]);

    act(() => result.current.controller.setStorageOpsEndpointFilter("b"));
    expect(
      result.current.controller.filteredStorageOpsEndpointItems.map(
        (endpoint) => endpoint.name,
      ),
    ).toEqual(["Endpoint B"]);

    act(() => result.current.controller.selectFilteredStorageOpsEndpoints());
    expect(result.current.advancedDraft.endpointNames).toEqual([
      "Endpoint A",
      "Endpoint B",
    ]);
    expect(
      result.current.controller.allFilteredStorageOpsEndpointsSelected,
    ).toBe(true);

    act(() => result.current.controller.deselectFilteredStorageOpsEndpoints());
    expect(result.current.advancedDraft.endpointNames).toEqual(["Endpoint A"]);
    act(() =>
      result.current.controller.toggleAdvancedEndpointName("Endpoint A"),
    );
    expect(result.current.advancedDraft.endpointNames).toEqual([]);
  });
});

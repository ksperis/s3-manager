/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAdvancedFilter,
  type AdvancedFilterState,
  type FeatureKey,
} from "./bucketOpsAdvancedFilterModel";
import {
  loadBucketListState,
  persistBucketListState,
  type BucketListState,
  type ColumnId,
} from "./bucketOpsListState";
import { useBucketOpsListState } from "./useBucketOpsListState";

const bucketsStateStorageKey = "bucket-ops-hook-list-state";
const columnsStorageKey = "bucket-ops-hook-columns";
const defaultVisibleColumns: ColumnId[] = ["tenant", "owner"];
const allFeaturesSupported: Record<FeatureKey, boolean> = {
  versioning: true,
  object_lock: true,
  block_public_access: true,
  lifecycle_rules: true,
  static_website: true,
  bucket_policy: true,
  cors: true,
  access_logging: true,
  notifications: true,
  server_side_encryption: true,
};

function createPersistedState(
  overrides: Partial<BucketListState> = {},
): BucketListState {
  return {
    filter: "archive",
    quickFilterMode: "exact",
    advancedApplied: null,
    tagFilters: [17],
    tagFilterMode: "all",
    page: 3,
    pageSize: 50,
    sort: { field: "owner", direction: "desc" },
    ...overrides,
  };
}

type HookOptions = Parameters<typeof useBucketOpsListState>[0];

function createOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    bucketsStateStorageKey,
    columnsStorageKey,
    defaultVisibleColumns,
    featureSupport: allFeaturesSupported,
    isStorageOps: false,
    ownerQueryFilter: null,
    selectedScopeId: 7,
    snsFeatureEnabled: true,
    sseFeatureEnabled: true,
    staticWebsiteFeatureEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBucketOpsListState", () => {
  it("restores one persisted scope without resetting its page after debounce", () => {
    vi.useFakeTimers();
    persistBucketListState(
      bucketsStateStorageKey,
      7,
      createPersistedState(),
    );
    localStorage.setItem(columnsStorageKey, JSON.stringify(["tenant"]));

    const { result } = renderHook(() =>
      useBucketOpsListState(createOptions()),
    );

    expect(result.current.filter).toBe("archive");
    expect(result.current.filterValue).toBe("archive");
    expect(result.current.quickFilterMode).toBe("exact");
    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.sort).toEqual({ field: "owner", direction: "desc" });
    expect(result.current.tagFilters).toEqual([17]);
    expect(result.current.tagFilterMode).toBe("all");
    expect(result.current.visibleColumns).toEqual(["tenant"]);

    act(() => vi.advanceTimersByTime(300));

    expect(result.current.page).toBe(3);
    expect(result.current.filterValue).toBe("archive");
  });

  it("uses an owner query as an exact transient prefill", () => {
    persistBucketListState(
      bucketsStateStorageKey,
      7,
      createPersistedState(),
    );

    const { result } = renderHook(() =>
      useBucketOpsListState(createOptions({ ownerQueryFilter: "tenant$alice" })),
    );

    expect(result.current.filter).toBe("");
    expect(result.current.filterValue).toBe("");
    expect(result.current.quickFilterMode).toBe("contains");
    expect(result.current.advancedApplied).toMatchObject({
      owner: "tenant$alice",
      ownerMatchMode: "exact",
    });
    expect(result.current.advancedDraft).toEqual(result.current.advancedApplied);
    expect(result.current.tagFilters).toEqual([]);
    expect(result.current.tagFilterMode).toBe("any");
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.sort).toEqual({ field: "owner", direction: "desc" });
  });

  it("never persists an old scope state over a newly selected scope", () => {
    const first = createPersistedState({ filter: "first", page: 2 });
    const second = createPersistedState({ filter: "second", page: 6 });
    persistBucketListState(bucketsStateStorageKey, 7, first);
    persistBucketListState(bucketsStateStorageKey, 8, second);
    const { result, rerender } = renderHook(
      ({ selectedScopeId }) =>
        useBucketOpsListState(createOptions({ selectedScopeId })),
      { initialProps: { selectedScopeId: 7 } },
    );

    act(() => result.current.setFilter("edited first"));
    expect(loadBucketListState(bucketsStateStorageKey, 7)?.filter).toBe(
      "edited first",
    );

    rerender({ selectedScopeId: 8 });

    expect(result.current.filter).toBe("second");
    expect(result.current.page).toBe(6);
    expect(loadBucketListState(bucketsStateStorageKey, 8)).toEqual(second);
  });

  it("debounces quick search and persists the resulting page reset", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useBucketOpsListState(createOptions()),
    );

    act(() => {
      result.current.setPage(5);
      result.current.setFilter("  logs  ");
    });
    act(() => vi.advanceTimersByTime(299));

    expect(result.current.filterValue).toBe("");
    expect(result.current.page).toBe(5);

    act(() => vi.advanceTimersByTime(1));

    expect(result.current.filterValue).toBe("logs");
    expect(result.current.page).toBe(1);
    expect(loadBucketListState(bucketsStateStorageKey, 7)).toMatchObject({
      filter: "  logs  ",
      page: 1,
    });
  });

  it("removes unsupported feature filters and columns", () => {
    const advancedApplied: AdvancedFilterState = {
      ...defaultAdvancedFilter,
      features: {
        ...defaultAdvancedFilter.features,
        notifications: "enabled",
        server_side_encryption: "enabled",
      },
      featureDetails: {
        ...defaultAdvancedFilter.featureDetails,
        notificationTopicName: "alerts",
        sseAlgorithm: "AES256",
      },
    };
    persistBucketListState(
      bucketsStateStorageKey,
      7,
      createPersistedState({ advancedApplied }),
    );
    localStorage.setItem(
      columnsStorageKey,
      JSON.stringify([
        "tenant",
        "static_website",
        "website_index_document",
        "notifications",
        "notification_topic_names",
        "server_side_encryption",
        "sse_algorithms",
      ]),
    );
    const featureSupport = {
      ...allFeaturesSupported,
      static_website: false,
      notifications: false,
      server_side_encryption: false,
    };

    const { result } = renderHook(() =>
      useBucketOpsListState(
        createOptions({
          featureSupport,
          snsFeatureEnabled: false,
          sseFeatureEnabled: false,
          staticWebsiteFeatureEnabled: false,
        }),
      ),
    );

    expect(result.current.advancedApplied?.features.notifications).toBe("any");
    expect(
      result.current.advancedApplied?.features.server_side_encryption,
    ).toBe("any");
    expect(result.current.advancedApplied?.featureDetails.notificationTopicName).toBe(
      "",
    );
    expect(result.current.advancedApplied?.featureDetails.sseAlgorithm).toBe("");
    expect(result.current.visibleColumns).toEqual(["tenant"]);
  });
});

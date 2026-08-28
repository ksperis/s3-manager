/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultAdvancedFilter,
  type AdvancedFilterState,
  type FeatureKey,
  type TextMatchMode,
} from "./bucketOpsAdvancedFilterModel";
import type { BucketListState } from "./bucketOpsListState";
import { useBucketOpsFilterController } from "./useBucketOpsFilterController";

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

type HarnessOptions = {
  advancedApplied?: AdvancedFilterState | null;
  advancedDraft?: AdvancedFilterState;
  filter?: string;
  filterValue?: string;
  page?: number;
  quickFilterMode?: TextMatchMode;
  tagFilterMode?: BucketListState["tagFilterMode"];
  tagFilters?: number[];
};

function useFilterHarness(options: HarnessOptions = {}) {
  const [advancedApplied, setAdvancedApplied] = useState<AdvancedFilterState | null>(
    options.advancedApplied ?? null,
  );
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedFilterState>(
    options.advancedDraft ?? defaultAdvancedFilter,
  );
  const [filter, setFilter] = useState(options.filter ?? "");
  const [filterValue, setFilterValue] = useState(options.filterValue ?? "");
  const [page, setPage] = useState(options.page ?? 1);
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>(
    options.quickFilterMode ?? "contains",
  );
  const [tagFilterMode, setTagFilterMode] = useState<BucketListState["tagFilterMode"]>(
    options.tagFilterMode ?? "any",
  );
  const [tagFilters, setTagFilters] = useState(options.tagFilters ?? []);
  const controller = useBucketOpsFilterController({
    advancedApplied,
    advancedDraft,
    featureSupport: allFeaturesSupported,
    filter,
    filterValue,
    isStorageOps: false,
    quickFilterMode,
    setAdvancedApplied,
    setAdvancedDraft,
    setFilter,
    setFilterValue,
    setPage,
    setQuickFilterMode,
    setTagFilterMode,
    setTagFilters,
    usageFeatureEnabled: true,
  });

  return {
    ...controller,
    advancedApplied,
    advancedDraft,
    filter,
    filterValue,
    page,
    quickFilterMode,
    tagFilterMode,
    tagFilters,
  };
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("useBucketOpsFilterController", () => {
  it("forces exact search for a pasted list", () => {
    const { result } = renderHook(() =>
      useFilterHarness({
        filter: "alpha, beta",
        filterValue: "alpha, beta",
      }),
    );

    expect(result.current.quickFilterDraftForcesExact).toBe(true);
    expect(result.current.quickFilterModeForDisplay).toBe("exact");
    expect(result.current.effectiveQuickFilterMode).toBe("exact");
    expect(result.current.effectiveQuickSearchValue).toBe("");
    expect(JSON.parse(result.current.advancedFilterParam ?? "null")).toEqual({
      match: "all",
      rules: [{ field: "name", op: "in", value: ["alpha", "beta"] }],
    });
  });

  it("applies the draft atomically and closes the drawer", () => {
    const advancedDraft = {
      ...defaultAdvancedFilter,
      owner: "tenant$alice",
      ownerMatchMode: "exact" as const,
    };
    const { result } = renderHook(() =>
      useFilterHarness({ advancedDraft, page: 4 }),
    );

    act(() => result.current.openAdvancedFilterDrawer());
    expect(result.current.showAdvancedFilter).toBe(true);

    act(() => result.current.applyAdvancedFilter());

    expect(result.current.advancedApplied).toEqual(advancedDraft);
    expect(result.current.page).toBe(1);
    expect(result.current.showAdvancedFilter).toBe(false);
  });

  it("owns quick-filter draft and tag match mode updates", () => {
    const { result } = renderHook(() => useFilterHarness({ page: 4 }));

    act(() => result.current.updateQuickFilterDraft("archive"));
    act(() => result.current.updateTagFilterMode("all"));

    expect(result.current.filter).toBe("archive");
    expect(result.current.tagFilterMode).toBe("all");
    expect(result.current.page).toBe(1);
  });

  it("routes Escape through the unsaved-changes guard", () => {
    const { result } = renderHook(() =>
      useFilterHarness({
        advancedDraft: { ...defaultAdvancedFilter, tenant: "finance" },
      }),
    );

    act(() => result.current.openAdvancedFilterDrawer());
    expect(document.body.style.overflow).toBe("hidden");

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(result.current.showAdvancedFilter).toBe(true);
    expect(result.current.advancedFilterCloseGuard.confirmationDialog).not.toBeNull();

    act(() => result.current.advancedFilterCloseGuard.closeWithoutConfirmation());

    expect(result.current.showAdvancedFilter).toBe(false);
    expect(result.current.advancedDraft.tenant).toBe("");
  });

  it("closes directly with Escape when the draft is synchronized", () => {
    const { result } = renderHook(() => useFilterHarness());

    act(() => result.current.openAdvancedFilterDrawer());
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(result.current.showAdvancedFilter).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("removes active filters from both draft and applied state", () => {
    const filtered: AdvancedFilterState = {
      ...defaultAdvancedFilter,
      featureDetails: {
        ...defaultAdvancedFilter.featureDetails,
        lifecycleRuleName: "archive",
      },
    };
    const { result } = renderHook(() =>
      useFilterHarness({
        advancedApplied: filtered,
        advancedDraft: filtered,
        page: 3,
        tagFilters: [7, 9],
      }),
    );

    act(() =>
      result.current.removeActiveFilterItem({
        type: "advanced_feature_detail",
        field: "lifecycleRuleName",
      }),
    );
    act(() => result.current.removeActiveFilterItem({ type: "tag", tag: 7 }));

    expect(result.current.advancedDraft.featureDetails.lifecycleRuleName).toBe("");
    expect(result.current.advancedApplied?.featureDetails.lifecycleRuleName).toBe("");
    expect(result.current.tagFilters).toEqual([9]);
    expect(result.current.page).toBe(1);
  });
});

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BucketOpsQuickFilter,
  BucketOpsTagAndAdvancedFilters,
} from "./BucketOpsListFilters";

describe("BucketOpsQuickFilter", () => {
  it("delegates draft and match mode updates", () => {
    const updateQuickFilterDraft = vi.fn();
    const toggleQuickFilterMode = vi.fn();
    render(
      <BucketOpsQuickFilter
        controller={{
          quickFilterDraftForcesExact: false,
          quickFilterFieldState: { fieldClass: "pending-filter" },
          quickFilterModeForDisplay: "contains",
          quickFilterPending: true,
          toggleQuickFilterMode,
          updateQuickFilterDraft,
        }}
        value="archive"
      />,
    );

    fireEvent.change(screen.getByLabelText("Quick filter"), {
      target: { value: "logs" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle quick filter match mode" }),
    );

    expect(updateQuickFilterDraft).toHaveBeenCalledWith("logs");
    expect(toggleQuickFilterMode).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Quick filter")).toHaveClass("pending-filter");
  });

  it("locks exact mode for list input", () => {
    render(
      <BucketOpsQuickFilter
        controller={{
          quickFilterDraftForcesExact: true,
          quickFilterFieldState: { fieldClass: "" },
          quickFilterModeForDisplay: "exact",
          quickFilterPending: false,
          toggleQuickFilterMode: vi.fn(),
          updateQuickFilterDraft: vi.fn(),
        }}
        value={'["archive"]'}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Toggle quick filter match mode" }),
    ).toBeDisabled();
  });
});

describe("BucketOpsTagAndAdvancedFilters", () => {
  const availableUiTags = [
    {
      id: 1,
      label: "critical",
      color_key: "red",
      scope: "standard" as const,
      visibility: "shared" as const,
    },
    {
      id: 2,
      label: "archive",
      color_key: "blue",
      scope: "standard" as const,
      visibility: "private" as const,
    },
  ];

  it("delegates tag selection, match mode, and advanced filter actions", () => {
    const addTagFilter = vi.fn();
    const removeTagFilter = vi.fn();
    const updateTagFilterMode = vi.fn();
    const openAdvancedFilterDrawer = vi.fn();
    render(
      <BucketOpsTagAndAdvancedFilters
        availableUiTags={availableUiTags}
        controller={{
          addTagFilter,
          advancedFiltersApplied: true,
          openAdvancedFilterDrawer,
          removeTagFilter,
          showAdvancedFilter: false,
          updateTagFilterMode,
        }}
        tagFilterMode="any"
        tagFilters={[1]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove UI tag filter critical, Shared",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add UI tag filter archive, Private",
      }),
    );
    fireEvent.change(screen.getByLabelText("UI tag filter match mode"), {
      target: { value: "all" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Advanced filter/ }));

    expect(removeTagFilter).toHaveBeenCalledWith(1);
    expect(addTagFilter).toHaveBeenCalledWith(2);
    expect(updateTagFilterMode).toHaveBeenCalledWith("all");
    expect(openAdvancedFilterDrawer).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Advanced filter · Active" }),
    ).toBeInTheDocument();
  });

  it("keeps the advanced filter action when the UI tag catalog is empty", () => {
    render(
      <BucketOpsTagAndAdvancedFilters
        availableUiTags={[]}
        controller={{
          addTagFilter: vi.fn(),
          advancedFiltersApplied: false,
          openAdvancedFilterDrawer: vi.fn(),
          removeTagFilter: vi.fn(),
          showAdvancedFilter: false,
          updateTagFilterMode: vi.fn(),
        }}
        tagFilterMode="any"
        tagFilters={[]}
      />,
    );

    expect(
      screen.queryByLabelText("UI tag filter match mode"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Advanced filter" }),
    ).toBeInTheDocument();
  });
});

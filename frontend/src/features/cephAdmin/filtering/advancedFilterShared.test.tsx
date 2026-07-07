import { render, screen } from "@testing-library/react";

import {
  advancedFilterControlClass,
  advancedFilterFieldCardClass,
  advancedFilterMatchModeButtonClass,
  advancedFilterSummaryChipClass,
  advancedFilterSyncBadgeClass,
  advancedFilterToolbarButtonClass,
  formatAdvancedFilterSyncLabel,
  formatQuickFilterMatchModeTitle,
  formatTextMatchModeSymbol,
  quickFilterMatchModeButtonClass,
  renderAdvancedFilterCostBadge,
  renderAdvancedFilterDraftSummary,
  renderAdvancedFilterRuleCountBadge,
  renderAdvancedSearchProgress,
  type AdvancedSearchProgress,
} from "./advancedFilterShared";

describe("advancedFilterShared", () => {
  it("returns stable classes for active and locked match-mode buttons", () => {
    expect(advancedFilterMatchModeButtonClass(true)).toContain("bg-primary-100");
    expect(advancedFilterMatchModeButtonClass(false, true)).toContain("cursor-not-allowed");
  });

  it("returns stable advanced-filter toolbar button classes", () => {
    expect(advancedFilterToolbarButtonClass(false)).toContain("ui-caption");
    expect(advancedFilterToolbarButtonClass(true)).toContain("bg-primary-50");
  });

  it("returns stable advanced-filter field card classes", () => {
    expect(advancedFilterFieldCardClass()).toBe("rounded-lg border border-slate-200 p-3 dark:border-slate-700");
    expect(advancedFilterFieldCardClass("md:col-span-2")).toBe(
      "rounded-lg border border-slate-200 p-3 dark:border-slate-700 md:col-span-2"
    );
  });

  it("returns stable advanced-filter control classes", () => {
    expect(advancedFilterControlClass()).toContain("focus:ring-primary/30");
    expect(advancedFilterControlClass("mt-2 w-full")).toContain("mt-2 w-full");
    expect(advancedFilterControlClass("", true)).toContain("disabled:cursor-not-allowed");
  });

  it("returns stable advanced-filter status badges and summary chip classes", () => {
    expect(advancedFilterSyncBadgeClass(true)).toContain("bg-amber-100");
    expect(advancedFilterSyncBadgeClass(false)).toContain("bg-emerald-100");
    expect(formatAdvancedFilterSyncLabel(true)).toBe("Unsaved changes");
    expect(formatAdvancedFilterSyncLabel(false)).toBe("In sync");
    expect(advancedFilterSummaryChipClass).toContain("bg-primary/10");
  });

  it("renders advanced-filter header badges consistently", () => {
    render(
      <>
        {renderAdvancedFilterRuleCountBadge(1)}
        {renderAdvancedFilterRuleCountBadge(2)}
        {renderAdvancedFilterCostBadge("high", "High cost")}
      </>
    );

    expect(screen.getByText("1 rule")).toBeInTheDocument();
    expect(screen.getByText("2 rules")).toBeInTheDocument();
    expect(screen.getByText("Global draft cost")).toHaveAttribute("title", "High cost");
  });

  it("renders advanced-filter draft summaries consistently", () => {
    const { rerender } = render(<>{renderAdvancedFilterDraftSummary([])}</>);

    expect(screen.getByText("Draft summary")).toBeInTheDocument();
    expect(screen.getByText("No advanced rule in draft.")).toBeInTheDocument();

    rerender(
      <>
        {renderAdvancedFilterDraftSummary([
          { id: "owner", label: "Owner contains demo" },
          { id: "bytes", label: "Size greater than 1 GiB" },
        ])}
      </>
    );

    expect(screen.getByText("Owner contains demo")).toBeInTheDocument();
    expect(screen.getByText("Size greater than 1 GiB")).toBeInTheDocument();
    expect(screen.queryByText("No advanced rule in draft.")).not.toBeInTheDocument();
  });

  it("returns stable quick-filter match-mode labels and classes", () => {
    expect(formatTextMatchModeSymbol("contains")).toBe("~");
    expect(formatTextMatchModeSymbol("exact")).toBe("=");
    expect(formatQuickFilterMatchModeTitle("contains")).toBe("Quick filter mode: contains");
    expect(formatQuickFilterMatchModeTitle("exact", true)).toBe("Quick filter mode: exact (locked by list input)");
    expect(quickFilterMatchModeButtonClass("contains", false)).toContain("hover:border-primary");
    expect(quickFilterMatchModeButtonClass("exact", false)).toContain("bg-primary-100");
    expect(quickFilterMatchModeButtonClass("contains", true)).toContain("bg-amber-100");
    expect(quickFilterMatchModeButtonClass("contains", false, true)).toContain("cursor-not-allowed");
  });

  it("renders progress through the shared progressbar primitive", () => {
    const progress: AdvancedSearchProgress = {
      active: true,
      determinate: true,
      percent: 42,
      stage: "scan",
      message: "Scanning buckets",
      processed: 21,
      total: 50,
    };

    render(<>{renderAdvancedSearchProgress(progress)}</>);

    expect(screen.getByText("Advanced search in progress · 42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Advanced search progress" })).toHaveAttribute(
      "aria-valuenow",
      "42"
    );
  });
});

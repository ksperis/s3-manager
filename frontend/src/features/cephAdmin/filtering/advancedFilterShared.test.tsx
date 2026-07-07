import { render, screen } from "@testing-library/react";

import {
  advancedFilterMatchModeButtonClass,
  formatQuickFilterMatchModeTitle,
  formatTextMatchModeSymbol,
  quickFilterMatchModeButtonClass,
  renderAdvancedSearchProgress,
  type AdvancedSearchProgress,
} from "./advancedFilterShared";

describe("advancedFilterShared", () => {
  it("returns stable classes for active and locked match-mode buttons", () => {
    expect(advancedFilterMatchModeButtonClass(true)).toContain("bg-primary-100");
    expect(advancedFilterMatchModeButtonClass(false, true)).toContain("cursor-not-allowed");
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

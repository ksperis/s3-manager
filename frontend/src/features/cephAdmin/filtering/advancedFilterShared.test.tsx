import { render, screen } from "@testing-library/react";

import {
  advancedFilterMatchModeButtonClass,
  renderAdvancedSearchProgress,
  type AdvancedSearchProgress,
} from "./advancedFilterShared";

describe("advancedFilterShared", () => {
  it("returns stable classes for active and locked match-mode buttons", () => {
    expect(advancedFilterMatchModeButtonClass(true)).toContain("bg-primary-100");
    expect(advancedFilterMatchModeButtonClass(false, true)).toContain("cursor-not-allowed");
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

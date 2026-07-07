import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ManagerBucketSelectionPanel from "./ManagerBucketSelectionPanel";

describe("ManagerBucketSelectionPanel", () => {
  it("uses shared controls and wires bucket selection actions", () => {
    const onFilterChange = vi.fn();
    const onToggleBucket = vi.fn();
    const onSelectFiltered = vi.fn();
    const onClearSelection = vi.fn();

    render(
      <ManagerBucketSelectionPanel
        description="Source context - Select buckets to check."
        filter=""
        filterPlaceholder="Filter buckets"
        onFilterChange={onFilterChange}
        buckets={[{ name: "alpha" }, { name: "beta" }]}
        selectedBuckets={new Set(["alpha"])}
        onToggleBucket={onToggleBucket}
        onSelectFiltered={onSelectFiltered}
        onClearSelection={onClearSelection}
        tableStatus="ready"
        loadingMessage="Loading buckets..."
        errorMessage="Unable to load buckets."
        emptyMessage="No buckets."
        action={
          <button type="button" data-testid="primary-action">
            Run selected
          </button>
        }
      />
    );

    const filter = screen.getByLabelText("Filter buckets");
    expect(filter).toHaveClass("ui-control");
    fireEvent.change(filter, { target: { value: "alp" } });
    expect(onFilterChange).toHaveBeenCalledWith("alp");

    fireEvent.click(screen.getByRole("button", { name: "Select filtered" }));
    expect(onSelectFiltered).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearSelection).toHaveBeenCalled();

    const alphaCheckbox = screen.getByRole("checkbox", { name: "Select alpha" });
    expect(alphaCheckbox).toBeChecked();
    expect(alphaCheckbox).toHaveClass("h-4", "w-4");
    fireEvent.click(alphaCheckbox);
    expect(onToggleBucket).toHaveBeenCalledWith("alpha");

    expect(within(screen.getByRole("table")).getByText("beta")).toBeInTheDocument();
    expect(screen.getByTestId("primary-action")).toBeInTheDocument();
  });
});

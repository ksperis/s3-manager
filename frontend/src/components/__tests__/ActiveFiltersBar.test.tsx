import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ActiveFiltersBar from "../ActiveFiltersBar";

describe("ActiveFiltersBar", () => {
  it("renders active filters and actions", () => {
    const remove = vi.fn();
    const clear = vi.fn();

    render(
      <ActiveFiltersBar
        items={[{ id: "versioning", label: "Versioning: Disabled", onRemove: remove, removeLabel: "Remove versioning" }]}
        onClearAll={clear}
      />
    );

    expect(screen.getByText("Active filters:")).toBeInTheDocument();
    expect(screen.getByText("Versioning: Disabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove versioning" }));
    expect(remove).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without items", () => {
    const { container } = render(<ActiveFiltersBar items={[]} onClearAll={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("supports summary-only filters without per-chip remove actions", () => {
    render(
      <ActiveFiltersBar
        items={[{ id: "search", label: "Search exact: gold" }]}
        onClearAll={vi.fn()}
        label="Active filters summary"
      />
    );

    expect(screen.getByText("Active filters summary")).toBeInTheDocument();
    expect(screen.getByText("Search exact: gold")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
  });
});

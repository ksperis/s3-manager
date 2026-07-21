import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PortalPageTabs from "./PortalPageTabs";

describe("PortalPageTabs", () => {
  it("renders top-level tabs with the shared divider and interaction", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PortalPageTabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "details", label: "Details" },
        ]}
        activeTab="overview"
        onChange={onChange}
        ariaLabel="Page sections"
      />,
    );

    expect(container.firstElementChild).toHaveClass("border-b", "pb-3");
    expect(screen.getByRole("tablist", { name: "Page sections" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(onChange).toHaveBeenCalledWith("details");
  });
});

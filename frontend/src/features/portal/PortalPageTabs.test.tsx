import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";

describe("PortalPageTabs", () => {
  it("renders top-level tabs with the shared divider and interaction", () => {
    const onChange = vi.fn();
    const { container } = render(
      <>
        <PortalPageTabs
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "details", label: "Details" },
          ]}
          activeTab="overview"
          onChange={onChange}
          ariaLabel="Page sections"
          idPrefix="portal-test"
        />
        <PortalTabPanel idPrefix="portal-test" tabId="overview">
          Overview content
        </PortalTabPanel>
      </>,
    );

    expect(container.firstElementChild).toHaveClass("border-b", "pb-3");
    expect(screen.getByRole("tablist", { name: "Page sections" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Overview");

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(onChange).toHaveBeenCalledWith("details");
  });
});

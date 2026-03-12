import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PortalSettingsConditionalBadge } from "./PortalSettingsLayout";

describe("PortalSettingsConditionalBadge", () => {
  it("renders the badge when visible=true", () => {
    render(<PortalSettingsConditionalBadge visible label="Experimental" />);
    expect(screen.getByText("Experimental")).toBeInTheDocument();
  });

  it("does not render the badge when visible=false", () => {
    render(<PortalSettingsConditionalBadge visible={false} label="Experimental" />);
    expect(screen.queryByText("Experimental")).not.toBeInTheDocument();
  });
});

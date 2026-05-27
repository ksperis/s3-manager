import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PortalSettingsPage from "./PortalSettingsPage";

describe("PortalSettingsPage", () => {
  it("renders mockup-style preference cards without advanced configuration text", () => {
    render(<PortalSettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.queryByText(/policy JSON/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ARN/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnostics/i)).not.toBeInTheDocument();
  });
});

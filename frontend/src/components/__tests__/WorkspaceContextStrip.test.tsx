import { render, screen } from "@testing-library/react";
import WorkspaceContextStrip from "../WorkspaceContextStrip";

describe("WorkspaceContextStrip", () => {
  it("renders context summary items and alerts", () => {
    render(
      <WorkspaceContextStrip
        label="Active context"
        title="Account A"
        description="Current execution scope."
        items={[
          { label: "Mode", value: "Admin", tone: "warning" },
          { label: "Identity", value: "tenant-admin", mono: true },
        ]}
        alerts={[{ tone: "warning", message: "Browser access is restricted for this context." }]}
      />
    );

    expect(screen.getByText("Active context")).toBeInTheDocument();
    expect(screen.getByText("Account A")).toBeInTheDocument();
    expect(screen.getByText("Current execution scope.")).toBeInTheDocument();
    expect(screen.getByText("Mode")).toBeInTheDocument();
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Browser access is restricted for this context.")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PortalActivityPage from "./PortalActivityPage";

const workspace = {
  spaces: [{ id: "research-data", name: "Research Data" }],
  activity: [
    {
      id: "api-activity-1",
      actor: "alice@example.com",
      action: "Uploaded",
      target: "report.csv",
      spaceId: "research-data",
      spaceName: "Research Data",
      timeLabel: "2m ago",
      ipAddress: "192.0.2.10",
    },
  ],
};

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => ({
    workspace,
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
  }),
}));

describe("PortalActivityPage", () => {
  it("renders activity rows from portal activity data and keeps IP in details", async () => {
    const user = userEvent.setup();
    render(<PortalActivityPage />);

    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("Uploaded").length).toBeGreaterThan(0);
    expect(screen.getByText("report.csv")).toBeInTheDocument();
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(0);
    expect(screen.queryByRole("columnheader", { name: "IP Address" })).not.toBeInTheDocument();
    expect(screen.queryByText("192.0.2.10")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("IP address")).toBeInTheDocument();
    expect(screen.getByText("192.0.2.10")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalActivityPage from "./PortalActivityPage";
import type { PortalWorkspaceActivityItem, PortalWorkspaceSpace } from "./portalWorkspaceModel";

const mocks = vi.hoisted(() => ({
  spaces: [] as Array<Pick<PortalWorkspaceSpace, "id" | "name">>,
  activity: [] as PortalWorkspaceActivityItem[],
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => ({
    workspace: {
      spaces: mocks.spaces,
      activity: mocks.activity,
    },
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
  }),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <PortalActivityPage />
    </MemoryRouter>
  );
}

describe("PortalActivityPage", () => {
  beforeEach(() => {
    mocks.spaces = [
      { id: "research-data", name: "Research Data" },
      { id: "lab-exchange", name: "Lab Exchange" },
    ];
    mocks.activity = [
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
      {
        id: "api-activity-2",
        actor: "bob@example.com",
        action: "Shared",
        target: "Lab Exchange",
        spaceId: "lab-exchange",
        spaceName: "Lab Exchange",
        timeLabel: "1h ago",
        ipAddress: "192.0.2.11",
      },
    ];
  });

  it("renders activity rows from portal activity data and keeps IP in details", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audit details" })).toBeInTheDocument();
    expect(screen.getByText("Recent changes")).toBeInTheDocument();
    expect(screen.queryByText("Recent workspace history")).not.toBeInTheDocument();
    expect(screen.queryByText("People active")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "File or item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Action" })).not.toBeInTheDocument();
    expect(screen.getByText("Visible spaces only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open spaces" })).toHaveAttribute("href", "/portal/storage-spaces");
    expect(screen.getByLabelText("Action")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Space")).toHaveClass("ui-control");
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com").closest("table")).toHaveClass("responsive-data-table");
    expect(screen.getAllByText("Uploaded").length).toBeGreaterThan(0);
    expect(screen.getByText("alice@example.com").closest("td")).toHaveTextContent("report.csv");
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "Next step" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open space" })[0]).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data"
    );
    expect(screen.getByText("alice@example.com").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    const researchDataCell = screen.getAllByText("Research Data").find((element) => element.closest("td"));
    expect(researchDataCell).toBeDefined();
    expect(researchDataCell!.closest("td")).toHaveAttribute("data-label", "Space");
    expect(screen.queryByRole("columnheader", { name: "IP Address" })).not.toBeInTheDocument();
    expect(screen.queryByText("192.0.2.10")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Show details" })[0]);
    expect(screen.getByText("IP address")).toBeInTheDocument();
    expect(screen.getByText("192.0.2.10")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Audit details" }));
    expect(screen.getByText("Recent workspace history")).toBeInTheDocument();
    expect(screen.getByText("People active")).toBeInTheDocument();
    expect(screen.getByText("Spaces touched")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "File or item" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Action" }).length).toBeGreaterThan(0);
  });

  it("points empty activity back to spaces", () => {
    mocks.activity = [];

    renderPage();

    expect(screen.getByText("Activity starts with your spaces")).toBeInTheDocument();
    expect(screen.getByText("Upload files, create folders, or invite collaborators from a space. The most recent changes will appear here.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open spaces" }).at(0)).toHaveAttribute("href", "/portal/storage-spaces");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

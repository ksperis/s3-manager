import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tableActionButtonClasses } from "../../components/tableActionClasses";
import PortalActivityPanel from "./PortalActivityPanel";
import type { PortalWorkspaceActivityItem, PortalWorkspaceSpace } from "./portalWorkspaceModel";

const mocks = vi.hoisted(() => ({
  spaces: [] as Array<Pick<PortalWorkspaceSpace, "id" | "name">>,
  activity: [] as PortalWorkspaceActivityItem[],
}));

function renderPage() {
  render(
    <MemoryRouter>
      <PortalActivityPanel workspace={{ spaces: mocks.spaces, activity: mocks.activity }} />
    </MemoryRouter>
  );
}

describe("PortalActivityPanel", () => {
  beforeEach(() => {
    mocks.spaces = [
      { id: "research-data", name: "Research Data" },
      { id: "lab-exchange", name: "Lab Exchange" },
    ];
    mocks.activity = [
      {
        id: "api-activity-1",
        actor: "alice@example.com",
        action: "Created Storage Space",
        target: "Research Data",
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

    expect(screen.getByText("Activity overview")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("Recent changes")).toBeInTheDocument();
    expect(screen.getByText("People active")).toBeInTheDocument();
    expect(screen.getByText("Spaces touched")).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Activity views" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Audit details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "File or item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Action" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Action")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Space")).toHaveClass("ui-control");
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com").closest("table")).toHaveClass("responsive-data-table");
    expect(screen.getAllByText("Created Storage Space").length).toBeGreaterThan(0);
    expect(screen.getByText("alice@example.com").closest("td")).toHaveTextContent("Research Data");
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    const openSpaceLinks = screen.getAllByRole("link", { name: "Open space" });
    expect(openSpaceLinks[0]).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data"
    );
    openSpaceLinks.forEach((link) => {
      expect(link).toHaveAttribute("class", tableActionButtonClasses);
    });
    const showDetailsButtons = screen.getAllByRole("button", { name: "Show details" });
    showDetailsButtons.forEach((button) => {
      expect(button).toHaveAttribute("class", tableActionButtonClasses);
    });
    expect(screen.getByText("alice@example.com").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    const researchDataCell = screen.getAllByText("Research Data").find((element) => element.closest("td"));
    expect(researchDataCell).toBeDefined();
    expect(researchDataCell!.closest("td")).toHaveAttribute("data-label", "Space");
    expect(screen.queryByRole("columnheader", { name: "IP Address" })).not.toBeInTheDocument();
    expect(screen.queryByText("192.0.2.10")).not.toBeInTheDocument();

    await user.click(showDetailsButtons[0]);
    expect(screen.getByText("Resource")).toBeInTheDocument();
    expect(screen.getAllByText("Action").length).toBeGreaterThan(1);
    expect(screen.getByText("IP address")).toBeInTheDocument();
    expect(screen.getByText("192.0.2.10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide details" })).toHaveAttribute(
      "class",
      tableActionButtonClasses,
    );
  });

  it("opens activity details when a neutral row cell is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    const activityRow = screen.getByText("alice@example.com").closest("tr");
    expect(activityRow).not.toBeNull();

    await user.click(within(activityRow!).getByText("2m ago"));

    expect(screen.getByText("IP address")).toBeInTheDocument();
    expect(screen.getByText("192.0.2.10")).toBeInTheDocument();
    expect(within(activityRow!).getByRole("button", { name: "Hide details" })).toBeInTheDocument();

    await user.click(screen.getByText("192.0.2.10"));
    expect(within(activityRow!).getByRole("button", { name: "Hide details" })).toBeInTheDocument();
  });

  it("points empty activity back to spaces", () => {
    mocks.activity = [];

    renderPage();

    expect(screen.getByText("Activity starts with your spaces")).toBeInTheDocument();
    expect(screen.getByText("Create spaces, manage collaborators and links, or update settings. The latest governance changes will appear here.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open spaces" }).at(0)).toHaveAttribute("href", "/portal/storage-spaces");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

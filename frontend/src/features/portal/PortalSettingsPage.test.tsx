import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalSettingsPage from "./PortalSettingsPage";

const mocks = vi.hoisted(() => ({
  fetchCurrentUserMock: vi.fn(),
  accountContext: {
    accounts: [
      {
        id: "101",
        name: "Research Account",
        tags: [],
        storage_endpoint_name: "ceph-eu",
      },
    ],
    selectedAccount: {
      id: "101",
      name: "Research Account",
      tags: [],
      storage_endpoint_name: "ceph-eu",
    },
    selectedAccountId: "101",
    setSelectedAccountId: vi.fn(),
    loading: false,
  },
  workspaceData: {
    workspace: {
      usedBytes: 1024,
      spaces: [
        { id: "space-a", status: "Active" },
        { id: "space-b", status: "Archived" },
      ],
    },
    loading: false,
  },
}));

vi.mock("../../api/users", () => ({
  fetchCurrentUser: () => mocks.fetchCurrentUserMock(),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => mocks.accountContext,
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.workspaceData,
}));

describe("PortalSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountContext.loading = false;
    mocks.workspaceData.loading = false;
    mocks.fetchCurrentUserMock.mockResolvedValue({
      id: 7,
      email: "portal@example.com",
      account_links: [{ account_id: 101, account_role: "portal_user" }],
    });
  });

  it("shows only the selected project context", async () => {
    render(<PortalSettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Review information for the project currently selected in the Portal.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByText("Research Account")).toBeInTheDocument();
    expect(screen.getByText("Workspace access")).toBeInTheDocument();
    expect(await screen.findByText("User")).toBeInTheDocument();
    expect(screen.getByText("ceph-eu")).toBeInTheDocument();
    expect(screen.getByText("1 active / 2 total")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preferences" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Security" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit preferences" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchCurrentUserMock).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["portal_manager", "Manager"],
    ["portal_none", "Limited access"],
  ])("renders %s project access as %s", async (accountRole, expectedLabel) => {
    mocks.fetchCurrentUserMock.mockResolvedValue({
      id: 7,
      email: "portal@example.com",
      account_links: [{ account_id: 101, account_role: accountRole }],
    });

    render(<PortalSettingsPage />);

    expect(await screen.findByText(expectedLabel)).toBeInTheDocument();
  });

  it("keeps the project card visible while project data is loading", async () => {
    mocks.accountContext.loading = true;
    mocks.workspaceData.loading = true;

    render(<PortalSettingsPage />);

    expect(screen.getByRole("heading", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByText("Loading project settings...")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchCurrentUserMock).toHaveBeenCalledTimes(1));
  });
});

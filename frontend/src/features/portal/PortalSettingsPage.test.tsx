import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalSettingsPage from "./PortalSettingsPage";

const mocks = vi.hoisted(() => ({
  fetchCurrentUserMock: vi.fn(),
  fetchProjectSettingsMock: vi.fn(),
  updateProjectSettingsMock: vi.fn(),
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

vi.mock("../../api/portalAccounts", () => ({
  fetchPortalProjectSettings: (...args: unknown[]) => mocks.fetchProjectSettingsMock(...args),
  updatePortalProjectSettings: (...args: unknown[]) => mocks.updateProjectSettingsMock(...args),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => mocks.accountContext,
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.workspaceData,
}));

describe("PortalSettingsPage", () => {
  const projectSettings = {
    effective: {
      browser_access_enabled: true,
      allow_private_storage_space_create: true,
      allow_portal_named_bucket_create: false,
      allow_portal_user_access_key_create: true,
      server_access_logging_enabled: true,
      server_access_log_retention_days: 30,
      storage_space_version_cleanup_enabled: true,
      max_portal_user_access_keys: 2,
      bucket_defaults: {
        versioning: true,
        enable_lifecycle: true,
        noncurrent_version_expiration_days: 90,
        enable_cors: false,
        cors_allowed_origins: ["https://portal.example.test"],
      },
    },
    project_override: {},
    delegated_to_portal_managers: false,
    can_update: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountContext.selectedAccountId = "101";
    mocks.accountContext.loading = false;
    mocks.workspaceData.loading = false;
    mocks.fetchCurrentUserMock.mockResolvedValue({
      id: 7,
      email: "portal@example.com",
      account_links: [{ account_id: 101, manager_role: null, portal_role: "portal_user" }],
    });
    mocks.fetchProjectSettingsMock.mockResolvedValue(projectSettings);
    mocks.updateProjectSettingsMock.mockImplementation((_accountId, payload) =>
      Promise.resolve({
        ...projectSettings,
        project_override: payload,
        delegated_to_portal_managers: true,
        can_update: true,
      })
    );
  });

  it("shows the selected project and effective settings in read-only mode", async () => {
    render(<PortalSettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Review the effective settings for the selected project.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByText("Research Account")).toBeInTheDocument();
    expect(screen.getByText("Workspace access")).toBeInTheDocument();
    expect(await screen.findByText("User")).toBeInTheDocument();
    expect(screen.getByText("ceph-eu")).toBeInTheDocument();
    expect(screen.getByText("1 active / 2 total")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Project settings" })).toBeInTheDocument();
    expect(screen.getByText("Version history retention")).toBeInTheDocument();
    expect(screen.getByLabelText("Browser workspace access override")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

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
    expect(mocks.fetchProjectSettingsMock).toHaveBeenCalledWith("101");
  });

  it("lets a delegated Portal Manager save and reset the shared project override", async () => {
    mocks.fetchProjectSettingsMock.mockResolvedValue({
      ...projectSettings,
      delegated_to_portal_managers: true,
      can_update: true,
    });

    render(<PortalSettingsPage />);

    fireEvent.change(await screen.findByLabelText("Browser workspace access override"), {
      target: { value: "disabled" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updateProjectSettingsMock).toHaveBeenCalledWith("101", {
        browser_access_enabled: false,
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset overrides" }));
    expect(screen.getByRole("heading", { name: "Reset all project overrides?" })).toBeInTheDocument();
    expect(screen.getAllByText("Research Account").length).toBeGreaterThan(1);
    expect(mocks.updateProjectSettingsMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reset overrides" }));
    await waitFor(() => expect(mocks.updateProjectSettingsMock).toHaveBeenLastCalledWith("101", {}));
  });

  it("reloads settings when the selected project changes", async () => {
    const { rerender } = render(<PortalSettingsPage />);
    await waitFor(() => expect(mocks.fetchProjectSettingsMock).toHaveBeenCalledWith("101"));

    mocks.accountContext.selectedAccountId = "202";
    rerender(<PortalSettingsPage />);

    await waitFor(() => expect(mocks.fetchProjectSettingsMock).toHaveBeenCalledWith("202"));
  });

  it.each([
    ["portal_manager", "Manager"],
    ["portal_user", "User"],
  ] as const)("renders %s project access as %s", async (portalRole, expectedLabel) => {
    mocks.fetchCurrentUserMock.mockResolvedValue({
      id: 7,
      email: "portal@example.com",
      account_links: [{ account_id: 101, manager_role: null, portal_role: portalRole }],
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

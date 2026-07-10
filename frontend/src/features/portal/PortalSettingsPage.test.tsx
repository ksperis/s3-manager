import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalSettingsPage from "./PortalSettingsPage";

const mocks = vi.hoisted(() => ({
  fetchCurrentUserMock: vi.fn(),
  updateCurrentUserMock: vi.fn(),
  setThemeMock: vi.fn(),
  setLanguagePreferenceMock: vi.fn(),
  setSelectedAccountIdMock: vi.fn(),
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
  updateCurrentUser: (...args: unknown[]) => mocks.updateCurrentUserMock(...args),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => ({
    ...mocks.accountContext,
    setSelectedAccountId: mocks.setSelectedAccountIdMock,
  }),
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.workspaceData,
}));

vi.mock("../../components/theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: mocks.setThemeMock }),
}));

vi.mock("../../components/language", () => ({
  useLanguage: () => ({ languagePreference: "auto", setLanguagePreference: mocks.setLanguagePreferenceMock }),
  useOptionalLanguage: () => undefined,
}));

describe("PortalSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem("user", JSON.stringify({ authType: "password", email: "stored@example.com" }));
    mocks.fetchCurrentUserMock.mockResolvedValue({
      id: 7,
      email: "portal@example.com",
      full_name: "Portal User",
      display_name: "Portal User",
      ui_language: "fr",
      quota_alerts_enabled: true,
      ui_preferences: { theme: "dark", selected_portal_account_id: "101" },
      account_links: [{ account_id: 101, account_role: "portal_user" }],
    });
  });

  it("splits real settings into tabs and moves short setting forms into modals", async () => {
    const user = userEvent.setup();
    render(<PortalSettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByText("Portal User")).toBeInTheDocument();
    expect(screen.getByText("portal@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit profile" }));
    const profileDialog = screen.getByRole("dialog", { name: "Edit profile" });
    expect(within(profileDialog).getByLabelText("Display name")).toHaveClass("ui-control");
    expect(within(profileDialog).getByLabelText("Email")).toHaveClass("ui-control");
    await user.click(within(profileDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Edit profile" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preferences" }));
    expect(screen.getByText("Français")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("Research Account")).toBeInTheDocument();
    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const preferencesDialog = screen.getByRole("dialog", { name: "Edit preferences" });
    expect(within(preferencesDialog).getByLabelText("Language")).toHaveClass("ui-control");
    expect(within(preferencesDialog).getByLabelText("Theme")).toHaveClass("ui-control");
    expect(within(preferencesDialog).getByLabelText("Default project")).toHaveClass("ui-control");
    expect(within(preferencesDialog).getByRole("checkbox", { name: "Receive quota alert emails" })).toHaveClass("text-primary");
    await user.click(within(preferencesDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Edit preferences" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Security" }));
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = screen.getByRole("dialog", { name: "Change password" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveClass("ui-control");
    expect(screen.getByLabelText("New password")).toHaveClass("ui-control");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Change password" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("heading", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByText("Workspace access")).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getByText("Storage service")).toBeInTheDocument();
    expect(screen.getByText("1 active / 2 total")).toBeInTheDocument();
    expect(screen.queryByText("Portal role")).not.toBeInTheDocument();
    expect(screen.queryByText("Portal user")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoint")).not.toBeInTheDocument();
    expect(screen.queryByText("acc-123456")).not.toBeInTheDocument();
    expect(screen.queryByText("MFA")).not.toBeInTheDocument();
    expect(screen.queryByText("Session timeout")).not.toBeInTheDocument();
    expect(screen.queryByText("Items per page")).not.toBeInTheDocument();
    expect(screen.queryByText("Date format")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchCurrentUserMock).toHaveBeenCalledTimes(1));
  });
});

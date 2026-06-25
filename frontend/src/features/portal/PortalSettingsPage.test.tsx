import { render, screen, waitFor } from "@testing-library/react";
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

  it("renders real profile, preference and account settings without mock-only fields", async () => {
    render(<PortalSettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Portal User")).toBeInTheDocument();
    expect(screen.getByDisplayValue("portal@example.com")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Portal account" })).toBeInTheDocument();
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

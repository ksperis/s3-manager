import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "./ProfilePage";

const listConnectionsMock = vi.fn();
const createConnectionMock = vi.fn();
const updateConnectionMock = vi.fn();
const rotateConnectionCredentialsMock = vi.fn();
const deleteConnectionMock = vi.fn();
const validateConnectionCredentialsMock = vi.fn();
const listStorageEndpointsMock = vi.fn();
const fetchCurrentUserMock = vi.fn();
const updateCurrentUserMock = vi.fn();
const setThemeMock = vi.fn();
const setLanguagePreferenceMock = vi.fn();

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      allow_user_private_connections: true,
    },
  }),
}));

vi.mock("../../components/theme", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: setThemeMock,
  }),
}));

vi.mock("../../components/language", () => ({
  useLanguage: () => ({
    languagePreference: "auto",
    setLanguagePreference: setLanguagePreferenceMock,
  }),
}));

vi.mock("../../api/users", () => ({
  fetchCurrentUser: () => fetchCurrentUserMock(),
  updateCurrentUser: (payload: unknown) => updateCurrentUserMock(payload),
}));

vi.mock("../../api/connections", () => ({
  listConnections: () => listConnectionsMock(),
  createConnection: (payload: unknown) => createConnectionMock(payload),
  updateConnection: (id: number, payload: unknown) => updateConnectionMock(id, payload),
  rotateConnectionCredentials: (id: number, payload: unknown) => rotateConnectionCredentialsMock(id, payload),
  deleteConnection: (id: number) => deleteConnectionMock(id),
  validateConnectionCredentials: (payload: unknown) => validateConnectionCredentialsMock(payload),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
}));

vi.mock("../../utils/workspaces", () => ({
  WORKSPACE_STORAGE_KEY: "workspace",
  isAdminLikeRole: () => true,
  readStoredUser: () => ({
    role: "ui_admin",
    authType: "password",
  }),
  readStoredWorkspaceId: () => null,
  resolveAvailableWorkspacesWithFlags: () => [],
}));

describe("ProfilePage live validation", () => {
  beforeEach(() => {
    listConnectionsMock.mockResolvedValue([]);
    listStorageEndpointsMock.mockResolvedValue([]);
    fetchCurrentUserMock.mockResolvedValue({
      full_name: "Admin User",
    });
    validateConnectionCredentialsMock.mockResolvedValue({
      ok: false,
      severity: "error",
      code: "InvalidAccessKeyId",
      message: "Invalid S3 credentials.",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows validation error without disabling Create connection", async () => {
    render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);
    await screen.findByText("Private S3 connections");

    fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
    await screen.findByText("Add private S3 connection");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "private-connection" } });
    fireEvent.change(screen.getByLabelText("Endpoint URL"), { target: { value: "https://s3.private.example.test" } });
    fireEvent.change(screen.getByLabelText("Access Key"), { target: { value: "AKIA-INVALID" } });
    fireEvent.change(screen.getByLabelText("Secret Key"), { target: { value: "SECRET-INVALID" } });

    await waitFor(() => {
      expect(validateConnectionCredentialsMock).toHaveBeenCalledTimes(1);
    }, { timeout: 3000 });
    expect(await screen.findByText("Invalid S3 credentials.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create connection" })).toBeEnabled();
  });
});

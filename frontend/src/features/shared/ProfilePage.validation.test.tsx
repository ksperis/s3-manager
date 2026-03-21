import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "./ProfilePage";

const listConnectionsMock = vi.fn();
const createConnectionMock = vi.fn();
const updateConnectionMock = vi.fn();
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
  const makeConnection = (overrides?: Partial<Record<string, unknown>>) => ({
    id: 42,
    name: "managed-connection",
    storage_endpoint_id: 2,
    is_public: false,
    is_shared: false,
    visibility: "private",
    access_manager: false,
    access_browser: true,
    is_active: true,
    endpoint_url: "https://managed-a.example.test",
    region: "us-east-1",
    provider_hint: "ceph",
    access_key_id: "AKIA***1234",
    force_path_style: false,
    verify_tls: true,
    capabilities: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    last_used_at: null,
    ...overrides,
  });

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
    updateConnectionMock.mockResolvedValue(makeConnection());
    deleteConnectionMock.mockResolvedValue(undefined);
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

  it("hides credentials action in private connections table", async () => {
    listConnectionsMock.mockResolvedValue([makeConnection()]);

    render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);

    await screen.findByText("managed-connection");
    expect(screen.queryByRole("button", { name: "Credentials" })).not.toBeInTheDocument();
  });

  it("edits a managed connection by changing endpoint preset", async () => {
    listConnectionsMock.mockResolvedValue([makeConnection()]);
    listStorageEndpointsMock.mockResolvedValue([
      { id: 2, name: "Endpoint A", endpoint_url: "https://managed-a.example.test", is_default: true },
      { id: 3, name: "Endpoint B", endpoint_url: "https://managed-b.example.test", is_default: false },
    ]);
    updateConnectionMock.mockResolvedValue(makeConnection({ storage_endpoint_id: 3 }));

    render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);
    await screen.findByText("managed-connection");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByText("Edit connection - managed-connection");

    const dialog = screen.getByRole("dialog");
    const presetRadio = within(dialog).getByLabelText("Endpoint UI existant") as HTMLInputElement;
    expect(presetRadio.checked).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Configured endpoint"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sauvegarder" }));

    await waitFor(() => {
      expect(updateConnectionMock).toHaveBeenCalledTimes(1);
    });
    const [id, payload] = updateConnectionMock.mock.calls[0] as [number, Record<string, unknown>];
    expect(id).toBe(42);
    expect(payload).toMatchObject({
      name: "managed-connection",
      storage_endpoint_id: 3,
      access_manager: false,
      access_browser: true,
    });
    expect(payload).not.toHaveProperty("endpoint_url");
    expect(payload).not.toHaveProperty("access_key_id");
    expect(payload).not.toHaveProperty("secret_access_key");
  });

  it("updates credentials from edit modal in custom mode and keeps save non-blocking", async () => {
    listConnectionsMock.mockResolvedValue([makeConnection()]);
    listStorageEndpointsMock.mockResolvedValue([
      { id: 2, name: "Endpoint A", endpoint_url: "https://managed-a.example.test", is_default: true },
    ]);
    updateConnectionMock.mockResolvedValue(makeConnection({ storage_endpoint_id: null, endpoint_url: "https://custom.example.test" }));

    render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);
    await screen.findByText("managed-connection");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByText("Edit connection - managed-connection");

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Endpoint custom"));
    fireEvent.change(within(dialog).getByLabelText("Endpoint URL"), { target: { value: "https://custom.example.test" } });
    fireEvent.change(within(dialog).getByLabelText("Access key ID"), { target: { value: "AKIA-NEW" } });
    fireEvent.change(within(dialog).getByLabelText("Secret access key"), { target: { value: "SECRET-NEW" } });

    await waitFor(() => {
      expect(validateConnectionCredentialsMock).toHaveBeenCalled();
    }, { timeout: 3000 });
    expect(await within(dialog).findByText("Invalid S3 credentials.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Sauvegarder" }));

    await waitFor(() => {
      expect(updateConnectionMock).toHaveBeenCalledTimes(1);
    });
    const [, payload] = updateConnectionMock.mock.calls[0] as [number, Record<string, unknown>];
    expect(payload).toMatchObject({
      storage_endpoint_id: null,
      endpoint_url: "https://custom.example.test",
      access_key_id: "AKIA-NEW",
      secret_access_key: "SECRET-NEW",
    });
  });

  it("shows validation error when only one credential field is provided in edit modal", async () => {
    listConnectionsMock.mockResolvedValue([makeConnection()]);
    listStorageEndpointsMock.mockResolvedValue([
      { id: 2, name: "Endpoint A", endpoint_url: "https://managed-a.example.test", is_default: true },
    ]);

    render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);
    await screen.findByText("managed-connection");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByText("Edit connection - managed-connection");

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Endpoint custom"));
    fireEvent.change(within(dialog).getByLabelText("Access key ID"), { target: { value: "AKIA-ONLY" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sauvegarder" }));

    await waitFor(() => {
      expect(
        within(dialog).getByText("Provide both access key ID and secret access key to update credentials.")
      ).toBeInTheDocument();
    });
    expect(updateConnectionMock).not.toHaveBeenCalled();
  });

  it("bulk disables selected private connections", async () => {
    listConnectionsMock.mockResolvedValue([
      makeConnection({ id: 41, name: "connection-a" }),
      makeConnection({ id: 42, name: "connection-b" }),
    ]);

    render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);
    await screen.findByText("connection-a");

    fireEvent.click(screen.getByLabelText("Select all filtered private connections"));
    fireEvent.click(screen.getByRole("button", { name: "Disable selected" }));

    await waitFor(() => {
      expect(updateConnectionMock).toHaveBeenCalledTimes(2);
    });
    expect(updateConnectionMock).toHaveBeenCalledWith(41, { is_active: false });
    expect(updateConnectionMock).toHaveBeenCalledWith(42, { is_active: false });
  });

  it("bulk activates selected private connections", async () => {
    listConnectionsMock.mockResolvedValue([
      makeConnection({ id: 41, name: "connection-a", is_active: false }),
      makeConnection({ id: 42, name: "connection-b", is_active: false }),
    ]);

    render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);
    await screen.findByText("connection-a");

    fireEvent.click(screen.getByLabelText("Select all filtered private connections"));
    fireEvent.click(screen.getByRole("button", { name: "Activate selected" }));

    await waitFor(() => {
      expect(updateConnectionMock).toHaveBeenCalledTimes(2);
    });
    expect(updateConnectionMock).toHaveBeenCalledWith(41, { is_active: true });
    expect(updateConnectionMock).toHaveBeenCalledWith(42, { is_active: true });
  });

  it("selects filtered connections across hidden paginated items", async () => {
    listConnectionsMock.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        makeConnection({
          id: 100 + index,
          name: `connection-${index + 1}`,
        })
      )
    );

    render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);
    await screen.findByText("connection-12");

    fireEvent.click(screen.getByLabelText("Select all filtered private connections"));
    fireEvent.click(screen.getByRole("button", { name: "Disable selected" }));

    await waitFor(() => {
      expect(updateConnectionMock).toHaveBeenCalledTimes(12);
    });
    expect(updateConnectionMock).toHaveBeenCalledWith(100, { is_active: false });
    expect(updateConnectionMock).toHaveBeenCalledWith(111, { is_active: false });
  });

  it("clears private connection selection when changing page", async () => {
    listConnectionsMock.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        makeConnection({
          id: 200 + index,
          name: `page-connection-${index + 1}`,
        })
      )
    );

    render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);
    await screen.findByText("page-connection-12");

    fireEvent.click(screen.getByLabelText("Select private connection page-connection-12"));
    expect(screen.getByRole("button", { name: "Disable selected" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Disable selected" })).not.toBeInTheDocument();
    });
  });

  it("bulk deletes selected private connections after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      listConnectionsMock.mockResolvedValue([
        makeConnection({ id: 41, name: "connection-a" }),
        makeConnection({ id: 42, name: "connection-b" }),
      ]);

      render(<ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />);
      await screen.findByText("connection-a");

      fireEvent.click(screen.getByLabelText("Select all filtered private connections"));
      fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

      await waitFor(() => {
        expect(deleteConnectionMock).toHaveBeenCalledTimes(2);
      });
      expect(deleteConnectionMock).toHaveBeenCalledWith(41);
      expect(deleteConnectionMock).toHaveBeenCalledWith(42);
    } finally {
      confirmSpy.mockRestore();
    }
  });
});

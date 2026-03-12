import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import S3ConnectionsPage from "./S3ConnectionsPage";

const listAdminS3ConnectionsMock = vi.fn();
const createAdminS3ConnectionMock = vi.fn();
const updateAdminS3ConnectionMock = vi.fn();
const rotateAdminS3ConnectionCredentialsMock = vi.fn();
const deleteAdminS3ConnectionMock = vi.fn();
const validateAdminS3ConnectionCredentialsMock = vi.fn();
const listS3ConnectionUsersMock = vi.fn();
const upsertS3ConnectionUserMock = vi.fn();
const removeS3ConnectionUserMock = vi.fn();

const listMinimalUsersMock = vi.fn();
const listStorageEndpointsMock = vi.fn();

vi.mock("../../api/s3ConnectionsAdmin", () => ({
  listAdminS3Connections: (params?: unknown) => listAdminS3ConnectionsMock(params),
  createAdminS3Connection: (payload: unknown) => createAdminS3ConnectionMock(payload),
  updateAdminS3Connection: (id: number, payload: unknown) => updateAdminS3ConnectionMock(id, payload),
  rotateAdminS3ConnectionCredentials: (id: number, payload: unknown) => rotateAdminS3ConnectionCredentialsMock(id, payload),
  deleteAdminS3Connection: (id: number) => deleteAdminS3ConnectionMock(id),
  validateAdminS3ConnectionCredentials: (payload: unknown) => validateAdminS3ConnectionCredentialsMock(payload),
  listS3ConnectionUsers: (connectionId: number) => listS3ConnectionUsersMock(connectionId),
  upsertS3ConnectionUser: (connectionId: number, payload: unknown) => upsertS3ConnectionUserMock(connectionId, payload),
  removeS3ConnectionUser: (connectionId: number, userId: number) => removeS3ConnectionUserMock(connectionId, userId),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: () => listMinimalUsersMock(),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
}));

const makeConnection = (id: number, overrides?: Partial<Record<string, unknown>>) => ({
  id,
  name: `connection-${id}`,
  endpoint_url: `https://endpoint-${id}.example.test`,
  visibility: "shared",
  is_public: false,
  is_shared: true,
  is_active: true,
  access_manager: true,
  access_browser: true,
  owner_user_id: 99,
  owner_email: "owner@example.com",
  user_count: 1,
  user_ids: [11],
  ...overrides,
});

describe("S3ConnectionsPage modal tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    localStorage.setItem("user", JSON.stringify({ id: 1 }));

    listAdminS3ConnectionsMock.mockResolvedValue({
      items: [makeConnection(1)],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    listMinimalUsersMock.mockResolvedValue([
      { id: 11, email: "u11@example.com" },
      { id: 12, email: "u12@example.com" },
      { id: 13, email: "u13@example.com" },
      { id: 99, email: "owner@example.com" },
    ]);

    listStorageEndpointsMock.mockResolvedValue([]);

    createAdminS3ConnectionMock.mockResolvedValue(makeConnection(2));
    updateAdminS3ConnectionMock.mockResolvedValue(makeConnection(1));
    rotateAdminS3ConnectionCredentialsMock.mockResolvedValue(makeConnection(1));
    deleteAdminS3ConnectionMock.mockResolvedValue(undefined);
    validateAdminS3ConnectionCredentialsMock.mockResolvedValue({
      ok: true,
      severity: "success",
      message: "Credentials valid",
    });

    listS3ConnectionUsersMock.mockResolvedValue([
      { user_id: 11, email: "u11@example.com" },
      { user_id: 12, email: "u12@example.com" },
    ]);
    upsertS3ConnectionUserMock.mockResolvedValue({ user_id: 13, email: "u13@example.com" });
    removeS3ConnectionUserMock.mockResolvedValue(undefined);
  });

  it("keeps linked UI user selections across tabs and syncs add/remove on save", async () => {
    render(<S3ConnectionsPage />);

    await screen.findByText("connection-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const generalTab = await screen.findByRole("button", { name: "General" });
    const usersTab = screen.getByRole("button", { name: "Linked UI users" });

    fireEvent.click(usersTab);

    fireEvent.click(screen.getByRole("button", { name: "Add UI users" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "u13@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(generalTab);
    fireEvent.click(usersTab);
    expect(screen.getByText("u13@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateAdminS3ConnectionMock).toHaveBeenCalled();
    });

    expect(listS3ConnectionUsersMock).toHaveBeenCalledWith(1);
    expect(upsertS3ConnectionUserMock).toHaveBeenCalledWith(1, { user_id: 13 });
    expect(removeS3ConnectionUserMock).toHaveBeenCalledWith(1, 12);
  });

  it("keeps users tab visible but disables link actions when visibility is not shared", async () => {
    render(<S3ConnectionsPage />);

    await screen.findByText("connection-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(await screen.findByRole("button", { name: "General" }));
    fireEvent.click(screen.getByLabelText("Private (owner only)"));

    fireEvent.click(screen.getByRole("button", { name: "Linked UI users" }));

    expect(screen.getByText("Linked UI users are available only for shared visibility.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add UI users" })).toBeDisabled();

    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    removeButtons.forEach((button) => expect(button).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateAdminS3ConnectionMock).toHaveBeenCalled();
    });

    expect(listS3ConnectionUsersMock).not.toHaveBeenCalled();
    expect(upsertS3ConnectionUserMock).not.toHaveBeenCalled();
    expect(removeS3ConnectionUserMock).not.toHaveBeenCalled();
  });

  it("resets edit tab and add-user panel when closing then reopening", async () => {
    render(<S3ConnectionsPage />);

    await screen.findByText("connection-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(await screen.findByRole("button", { name: "Linked UI users" }));
    fireEvent.click(screen.getByRole("button", { name: "Add UI users" }));
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByText("Connection details");

    fireEvent.click(screen.getByRole("button", { name: "Linked UI users" }));
    expect(screen.getByRole("button", { name: "Add UI users" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
  });
});

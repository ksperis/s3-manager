import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  owner_user_id: 1,
  owner_email: "owner@example.test",
  user_count: 0,
  user_ids: [],
  ...overrides,
});

describe("S3ConnectionsPage live validation", () => {
  beforeEach(() => {
    listAdminS3ConnectionsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });
    listMinimalUsersMock.mockResolvedValue([]);
    listStorageEndpointsMock.mockResolvedValue([]);
    validateAdminS3ConnectionCredentialsMock.mockResolvedValue({
      ok: false,
      severity: "error",
      code: "InvalidAccessKeyId",
      message: "Invalid S3 credentials.",
    });
    listS3ConnectionUsersMock.mockResolvedValue([]);
    upsertS3ConnectionUserMock.mockResolvedValue(undefined);
    removeS3ConnectionUserMock.mockResolvedValue(undefined);
    updateAdminS3ConnectionMock.mockResolvedValue(makeConnection(1));
    deleteAdminS3ConnectionMock.mockResolvedValue(undefined);
    localStorage.setItem("user", JSON.stringify({ id: 1 }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows validation error without disabling Create", async () => {
    render(<S3ConnectionsPage />);
    await screen.findByRole("button", { name: "Add connection" });

    fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
    await screen.findByText("Add S3 Connection");

    const createButton = screen.getByRole("button", { name: "Create" });
    const form = createButton.closest("form");
    if (!form) {
      throw new Error("Create modal form not found");
    }
    const textInputs = Array.from(form.querySelectorAll("input")).filter(
      (input) => input.type !== "radio" && input.type !== "checkbox"
    );
    const nameInput = textInputs[0];
    const endpointInput = textInputs.find((input) => input.placeholder === "https://s3.amazonaws.com");
    const accessKeyInput = textInputs[3];
    const secretKeyInput = textInputs[4];
    if (!nameInput || !endpointInput || !accessKeyInput || !secretKeyInput) {
      throw new Error("Expected create modal inputs were not found");
    }

    fireEvent.change(nameInput, { target: { value: "my-connection" } });
    fireEvent.change(endpointInput, { target: { value: "https://s3.example.test" } });
    fireEvent.change(accessKeyInput, { target: { value: "AKIA-INVALID" } });
    fireEvent.change(secretKeyInput, { target: { value: "SECRET-INVALID" } });

    await waitFor(() => {
      expect(validateAdminS3ConnectionCredentialsMock).toHaveBeenCalledTimes(1);
    }, { timeout: 3000 });
    expect(await screen.findByText("Invalid S3 credentials.")).toBeInTheDocument();
    expect(createButton).toBeEnabled();
  });

  it("deactivates selected connections in bulk", async () => {
    listAdminS3ConnectionsMock.mockResolvedValue({
      items: [makeConnection(1), makeConnection(2)],
      total: 2,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<S3ConnectionsPage />);
    await screen.findByText("connection-1");

    fireEvent.click(screen.getByLabelText("Select connection connection-1"));
    fireEvent.click(screen.getByLabelText("Select connection connection-2"));
    fireEvent.click(screen.getByRole("button", { name: "Disable selected" }));

    await waitFor(() => {
      expect(updateAdminS3ConnectionMock).toHaveBeenCalledTimes(2);
    });
    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(1, { is_active: false });
    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(2, { is_active: false });
  });

  it("activates selected connections in bulk", async () => {
    listAdminS3ConnectionsMock.mockResolvedValue({
      items: [makeConnection(1, { is_active: false }), makeConnection(2, { is_active: false })],
      total: 2,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<S3ConnectionsPage />);
    await screen.findByText("connection-1");

    fireEvent.click(screen.getByLabelText("Select connection connection-1"));
    fireEvent.click(screen.getByLabelText("Select connection connection-2"));
    fireEvent.click(screen.getByRole("button", { name: "Activate selected" }));

    await waitFor(() => {
      expect(updateAdminS3ConnectionMock).toHaveBeenCalledTimes(2);
    });
    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(1, { is_active: true });
    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(2, { is_active: true });
  });

  it("selects all filtered connections across paginated hidden items", async () => {
    listAdminS3ConnectionsMock.mockImplementation((params?: { page?: number; page_size?: number }) => {
      if (params?.page_size === 200 && params?.page === 2) {
        return Promise.resolve({
          items: [makeConnection(3)],
          total: 3,
          page: 2,
          page_size: 200,
          has_next: false,
        });
      }
      if (params?.page_size === 200) {
        return Promise.resolve({
          items: [makeConnection(1), makeConnection(2)],
          total: 3,
          page: 1,
          page_size: 200,
          has_next: true,
        });
      }
      return Promise.resolve({
        items: [makeConnection(1), makeConnection(2)],
        total: 3,
        page: params?.page ?? 1,
        page_size: params?.page_size ?? 25,
        has_next: true,
      });
    });

    render(<S3ConnectionsPage />);
    await screen.findByText("connection-1");

    fireEvent.click(screen.getByLabelText("Select all filtered connections"));
    await screen.findByRole("button", { name: "Disable selected" });
    fireEvent.click(screen.getByRole("button", { name: "Disable selected" }));

    await waitFor(() => {
      expect(updateAdminS3ConnectionMock).toHaveBeenCalledTimes(3);
    });
    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(1, { is_active: false });
    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(2, { is_active: false });
    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(3, { is_active: false });
  });

  it("clears selection when changing page", async () => {
    listAdminS3ConnectionsMock.mockImplementation((params?: { page?: number; page_size?: number }) => {
      if (params?.page === 2) {
        return Promise.resolve({
          items: [makeConnection(26)],
          total: 26,
          page: 2,
          page_size: 25,
          has_next: false,
        });
      }
      return Promise.resolve({
        items: Array.from({ length: 25 }, (_, index) => makeConnection(index + 1)),
        total: 26,
        page: 1,
        page_size: 25,
        has_next: true,
      });
    });

    render(<S3ConnectionsPage />);
    await screen.findByText("connection-1");

    fireEvent.click(screen.getByLabelText("Select connection connection-1"));
    expect(screen.getByRole("button", { name: "Disable selected" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("connection-26");

    expect(screen.queryByRole("button", { name: "Disable selected" })).not.toBeInTheDocument();
  });

  it("deletes selected connections in bulk with confirmation modal", async () => {
    listAdminS3ConnectionsMock.mockResolvedValue({
      items: [makeConnection(1), makeConnection(2)],
      total: 2,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<S3ConnectionsPage />);
    await screen.findByText("connection-1");

    fireEvent.click(screen.getByLabelText("Select connection connection-1"));
    fireEvent.click(screen.getByLabelText("Select connection connection-2"));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    await screen.findByText("Delete selected (2)");
    fireEvent.click(screen.getByRole("button", { name: "Delete selected connections" }));

    await waitFor(() => {
      expect(deleteAdminS3ConnectionMock).toHaveBeenCalledTimes(2);
    });
    expect(deleteAdminS3ConnectionMock).toHaveBeenCalledWith(1);
    expect(deleteAdminS3ConnectionMock).toHaveBeenCalledWith(2);
  });
});

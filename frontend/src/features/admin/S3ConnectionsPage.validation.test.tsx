import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import S3ConnectionsPage from "./S3ConnectionsPage";

const listAdminS3ConnectionsMock = vi.fn();
const createAdminS3ConnectionMock = vi.fn();
const updateAdminS3ConnectionMock = vi.fn();
const rotateAdminS3ConnectionCredentialsMock = vi.fn();
const deleteAdminS3ConnectionMock = vi.fn();
const validateAdminS3ConnectionCredentialsMock = vi.fn();
const listMinimalUsersMock = vi.fn();
const listStorageEndpointsMock = vi.fn();

vi.mock("../../api/s3ConnectionsAdmin", () => ({
  listAdminS3Connections: (params?: unknown) => listAdminS3ConnectionsMock(params),
  createAdminS3Connection: (payload: unknown) => createAdminS3ConnectionMock(payload),
  updateAdminS3Connection: (id: number, payload: unknown) => updateAdminS3ConnectionMock(id, payload),
  rotateAdminS3ConnectionCredentials: (id: number, payload: unknown) => rotateAdminS3ConnectionCredentialsMock(id, payload),
  deleteAdminS3Connection: (id: number) => deleteAdminS3ConnectionMock(id),
  validateAdminS3ConnectionCredentials: (payload: unknown) => validateAdminS3ConnectionCredentialsMock(payload),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: () => listMinimalUsersMock(),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
}));

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
  });

  afterEach(() => {
    vi.clearAllMocks();
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
});

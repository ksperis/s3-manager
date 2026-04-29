import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const listAdminTagDefinitionsMock = vi.fn();

function expectBefore(first: Element, second: Element) {
  expect(Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
}

const makeTag = (id: number, label: string, color_key = "neutral", scope = "standard") => ({
  id,
  label,
  color_key,
  scope,
});

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

vi.mock("../../api/tags", () => ({
  listAdminTagDefinitions: (domain: unknown) => listAdminTagDefinitionsMock(domain),
  listPrivateConnectionTagDefinitions: vi.fn(),
}));

const makeConnection = (id: number, overrides?: Partial<Record<string, unknown>>) => ({
  id,
  name: `connection-${id}`,
  tags: [makeTag(701, "shared", "sky")],
  endpoint_url: `https://endpoint-${id}.example.test`,
  is_shared: true,
  is_active: true,
  access_manager: true,
  access_browser: true,
  created_by_user_id: 99,
  created_by_email: "owner@example.com",
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
    listAdminTagDefinitionsMock.mockResolvedValue([makeTag(701, "shared", "sky"), makeTag(702, "prod")]);

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
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this shared connection" });
    expect(tagInput).toBeInTheDocument();
    expectBefore(within(dialog).getByDisplayValue("connection-1"), tagInput);
    expectBefore(tagInput, within(dialog).getByText("Endpoint"));
    expect(within(dialog).getByRole("radio", { name: "Configured endpoint" })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Custom endpoint" })).toBeChecked();
    expect(within(dialog).getByRole("combobox", { name: "Provider" })).toHaveValue("");

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
    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        tags: [expect.objectContaining({ label: "shared", color_key: "sky" })],
      })
    );
    expect(upsertS3ConnectionUserMock).toHaveBeenCalledWith(1, { user_id: 13 });
    expect(removeS3ConnectionUserMock).toHaveBeenCalledWith(1, 12);
  });

  it("keeps users tab actions enabled for shared-only admin connections", async () => {
    listS3ConnectionUsersMock.mockResolvedValue([{ user_id: 11, email: "u11@example.com" }]);
    render(<S3ConnectionsPage />);

    await screen.findByText("connection-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(screen.getByRole("button", { name: "Linked UI users" }));
    expect(screen.getByRole("button", { name: "Add UI users" })).toBeEnabled();
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    removeButtons.forEach((button) => expect(button).toBeEnabled());
    expect(screen.queryByText("Linked UI users are available only for shared visibility.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Private (owner only)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Public (visible to all)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateAdminS3ConnectionMock).toHaveBeenCalled();
    });

    expect(listS3ConnectionUsersMock).toHaveBeenCalledWith(1);
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
    await within(screen.getByRole("dialog")).findByText("Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "Linked UI users" }));
    expect(screen.getByRole("button", { name: "Add UI users" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
  });

  it("creates a shared connection with tags", async () => {
    render(<S3ConnectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Add connection" }));
    await screen.findByText("Add S3 Connection");

    const dialog = screen.getByRole("dialog");
    const nameInput = dialog.querySelector("input[required]") as HTMLInputElement | null;
    if (!nameInput) {
      throw new Error("Name input not found");
    }

    fireEvent.change(nameInput, { target: { value: "tagged-shared-connection" } });
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this shared connection" });
    expectBefore(nameInput, tagInput);
    expectBefore(tagInput, within(dialog).getByText("Endpoint"));
    expect(within(dialog).getByRole("radio", { name: "Configured endpoint" })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Custom endpoint" })).toBeChecked();
    const providerSelect = within(dialog).getByRole("combobox", { name: "Provider" });
    expect(providerSelect).toHaveValue("");
    fireEvent.change(providerSelect, { target: { value: "aws" } });
    fireEvent.change(tagInput, {
      target: { value: "finance" },
    });
    fireEvent.keyDown(tagInput, { key: "Enter", code: "Enter" });
    fireEvent.change(within(dialog).getByPlaceholderText("https://s3.example.com"), {
      target: { value: "https://tagged.example.test" },
    });
    const textInputs = dialog.querySelectorAll("input:not([type='radio']):not([type='checkbox'])");
    fireEvent.change(textInputs[textInputs.length - 2] as HTMLInputElement, { target: { value: "AKIA-TAGGED" } });
    fireEvent.change(textInputs[textInputs.length - 1] as HTMLInputElement, { target: { value: "SECRET-TAGGED" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createAdminS3ConnectionMock).toHaveBeenCalled();
    });
    expect(createAdminS3ConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tagged-shared-connection",
        provider_hint: "aws",
        tags: [expect.objectContaining({ label: "finance", color_key: "neutral" })],
      })
    );
  });

  it("hides provider for admin connections using an existing endpoint", async () => {
    listStorageEndpointsMock.mockResolvedValue([
      { id: 7, name: "Endpoint A", endpoint_url: "https://endpoint-a.example.test", is_default: true },
    ]);
    listAdminS3ConnectionsMock.mockResolvedValue({
      items: [makeConnection(7, { storage_endpoint_id: 7, endpoint_url: "https://endpoint-a.example.test" })],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<S3ConnectionsPage />);

    await screen.findByText("connection-7");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Endpoint");
    expect(within(dialog).getByRole("radio", { name: "Configured endpoint" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Custom endpoint" })).not.toBeChecked();
    expect(within(dialog).queryByRole("combobox", { name: "Provider" })).not.toBeInTheDocument();
  });
});

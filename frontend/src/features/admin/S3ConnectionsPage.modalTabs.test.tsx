import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import S3ConnectionsPage from "./S3ConnectionsPage";
import { setSessionUserCache } from "../../utils/workspaces";

const listAdminS3ConnectionsMock = vi.fn();
const createAdminS3ConnectionMock = vi.fn();
const updateAdminS3ConnectionMock = vi.fn();
const remediateAdminS3ConnectionMock = vi.fn();
const deleteAdminS3ConnectionMock = vi.fn();
const validateAdminS3ConnectionCredentialsMock = vi.fn();

const listMinimalUsersMock = vi.fn();
const listMinimalGroupsMock = vi.fn();
const listStorageEndpointsMock = vi.fn();
const listAdminTagDefinitionsMock = vi.fn();

function expectBefore(first: Element, second: Element) {
  expect(Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
}

function getWorkflowPage(title: string): HTMLElement {
  const page = screen.getByRole("heading", { name: title }).closest(".workflow-page");
  if (!page) {
    throw new Error(`Workflow page not found: ${title}`);
  }
  return page as HTMLElement;
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
  remediateAdminS3Connection: (id: number) => remediateAdminS3ConnectionMock(id),
  deleteAdminS3Connection: (id: number) => deleteAdminS3ConnectionMock(id),
  validateAdminS3ConnectionCredentials: (payload: unknown) => validateAdminS3ConnectionCredentialsMock(payload),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: () => listMinimalUsersMock(),
}));

vi.mock("../../api/groups", () => ({
  listMinimalGroups: () => listMinimalGroupsMock(),
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
  is_active: true,
  execution_status: "ready",
  created_by_user_id: 99,
  created_by_email: "owner@example.com",
  user_count: 1,
  user_details: [{ id: 11, email: "u11@example.com", role: "ui_user" }],
  ...overrides,
});

describe("S3ConnectionsPage modal tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    setSessionUserCache({ id: 1 });

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
    listMinimalGroupsMock.mockResolvedValue([
      { id: 31, name: "Storage Operators" },
      { id: 32, name: "Data Readers" },
    ]);

    listStorageEndpointsMock.mockResolvedValue([]);
    listAdminTagDefinitionsMock.mockResolvedValue([makeTag(701, "shared", "sky"), makeTag(702, "prod")]);

    createAdminS3ConnectionMock.mockResolvedValue(makeConnection(2));
    updateAdminS3ConnectionMock.mockResolvedValue(makeConnection(1));
    remediateAdminS3ConnectionMock.mockResolvedValue(makeConnection(1));
    deleteAdminS3ConnectionMock.mockResolvedValue(undefined);
    validateAdminS3ConnectionCredentialsMock.mockResolvedValue({
      ok: true,
      severity: "success",
      message: "Credentials valid",
    });

  });

  afterEach(() => {
    setSessionUserCache(null);
  });

  it("renders direct UI users and UI groups in the combined listing column", async () => {
    listAdminS3ConnectionsMock.mockResolvedValueOnce({
      items: [
        makeConnection(1, {
          user_details: [{ id: 11, email: "u11@example.com", role: "ui_user" }],
          group_details: [{ id: 31, name: "Storage Operators" }],
        }),
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<S3ConnectionsPage />);

    expect(await screen.findByRole("columnheader", { name: "UI Users / Groups" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    const connectionName = await within(table).findByText("connection-1");
    expect(connectionName.closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).getByText("https://endpoint-1.example.test").closest("td")).toHaveAttribute("data-label", "Endpoint");
    expect(within(table).getByText("Active").closest("td")).toHaveAttribute("data-label", "Status");
    expect(within(table).getByTitle("owner@example.com").closest("td")).toHaveAttribute("data-label", "Created by");
    const associations = await screen.findByLabelText("2 linked principals");
    expect(associations).toHaveAccessibleDescription(
      "Linked principals (2)\nUI user: u11@example.com\nUI group: Storage Operators",
    );
    expect(associations).toBeInTheDocument();
    expect(associations.querySelector(".rounded-lg")).toBeInTheDocument();
    expect(associations.closest("td")).toHaveAttribute("data-label", "UI Users / Groups");
    expect(within(table).getByRole("button", { name: "Edit" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
  });

  it("keeps linked UI user selections across tabs and submits user_ids", async () => {
    render(<S3ConnectionsPage />);

    await screen.findByText("connection-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const generalTab = await screen.findByRole("tab", { name: "General" });
    const usersTab = screen.getByRole("tab", { name: "Linked UI users" });
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    const dialog = getWorkflowPage("Edit connection · connection-1");
    expect(
      within(dialog).getByText(
        "Manage endpoint access, credentials, workspace availability, and UI associations for this shared connection."
      )
    ).toBeInTheDocument();
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this shared connection" });
    expect(tagInput).toBeInTheDocument();
    expect(tagInput.parentElement?.parentElement?.className).toContain("min-h-10");
    const tagLabel = within(dialog).getByText("Tags");
    expect(tagLabel).toHaveAttribute("for", tagInput.id);
    expect(tagLabel.parentElement).toHaveClass("flex", "flex-col", "gap-1");
    expect(
      within(dialog).queryByText("Shared tags are reused across accounts, S3 users and shared connections in the admin-managed domain.")
    ).not.toBeInTheDocument();
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

    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        tags: [expect.objectContaining({ label: "shared", color_key: "sky" })],
        user_ids: [11, 13],
      })
    );
  });

  it("updates metadata and credentials through one Admin request", async () => {
    render(<S3ConnectionsPage />);

    await screen.findByText("connection-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = getWorkflowPage("Edit connection · connection-1");
    fireEvent.change(within(dialog).getByLabelText("Name *"), {
      target: { value: "connection-updated" },
    });
    fireEvent.change(within(dialog).getByLabelText("Access key ID"), {
      target: { value: " UPDATED-ACCESS " },
    });
    fireEvent.change(within(dialog).getByLabelText("Secret access key"), {
      target: { value: " UPDATED-SECRET " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateAdminS3ConnectionMock).toHaveBeenCalledTimes(1);
    });
    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        name: "connection-updated",
        credentials: {
          access_key_id: "UPDATED-ACCESS",
          secret_access_key: "UPDATED-SECRET",
        },
      }),
    );
  });

  it("keeps linked UI group selections across tabs and submits group_ids", async () => {
    render(<S3ConnectionsPage />);

    await screen.findByText("connection-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI groups" }));
    expect(screen.getByText("No linked groups yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Storage Operators" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("tab", { name: "Linked UI groups" }));
    expect(screen.getByText("Storage Operators")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateAdminS3ConnectionMock).toHaveBeenCalled();
    });

    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        group_ids: [31],
      })
    );
  });

  it("keeps users tab actions enabled for shared-only admin connections", async () => {
    render(<S3ConnectionsPage />);

    await screen.findByText("connection-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(screen.getByRole("tab", { name: "Linked UI users" }));
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

    expect(updateAdminS3ConnectionMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ user_ids: [11] }),
    );
  });

  it("resets edit tab and add-user panel when closing then reopening", async () => {
    render(<S3ConnectionsPage />);

    await screen.findByText("connection-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));
    fireEvent.click(screen.getByRole("button", { name: "Add UI users" }));
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await within(getWorkflowPage("Edit connection · connection-1")).findByText("Endpoint");

    fireEvent.click(screen.getByRole("tab", { name: "Linked UI users" }));
    expect(screen.getByRole("button", { name: "Add UI users" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
  });

  it("creates a shared connection with tags", async () => {
    render(<S3ConnectionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Add connection" }));
    await screen.findByRole("heading", { name: "Add S3 connection" });

    const dialog = getWorkflowPage("Add S3 connection");
    expect(
      within(dialog).getByText(
        "Configure endpoint access, credentials, and workspace availability for this shared connection."
      )
    ).toBeInTheDocument();
    const nameInput = dialog.querySelector("input[required]") as HTMLInputElement | null;
    if (!nameInput) {
      throw new Error("Name input not found");
    }
    expect(nameInput).toHaveClass("ui-control");

    fireEvent.change(nameInput, { target: { value: "tagged-shared-connection" } });
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this shared connection" });
    expect(tagInput.parentElement?.parentElement?.className).toContain("min-h-10");
    const tagLabel = within(dialog).getByText("Tags");
    expect(tagLabel).toHaveAttribute("for", tagInput.id);
    expect(tagLabel.parentElement).toHaveClass("flex", "flex-col", "gap-1");
    expect(
      within(dialog).queryByText("Shared tags are reused across accounts, S3 users and shared connections in the admin-managed domain.")
    ).not.toBeInTheDocument();
    expectBefore(nameInput, tagInput);
    expectBefore(tagInput, within(dialog).getByText("Endpoint"));
    expect(within(dialog).getByRole("radio", { name: "Configured endpoint" })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Custom endpoint" })).toBeChecked();
    const providerSelect = within(dialog).getByRole("combobox", { name: "Provider" });
    expect(providerSelect).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Endpoint URL")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Access key ID *")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Secret access key *")).toHaveClass("ui-control");
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

    const dialog = getWorkflowPage("Edit connection · connection-7");
    await within(dialog).findByText("Endpoint");
    expect(within(dialog).getByRole("radio", { name: "Configured endpoint" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Custom endpoint" })).not.toBeChecked();
    expect(within(dialog).queryByRole("combobox", { name: "Provider" })).not.toBeInTheDocument();
  });
});

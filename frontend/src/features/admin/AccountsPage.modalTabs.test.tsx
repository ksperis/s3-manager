import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountsPage from "./AccountsPage";

const listS3AccountsMock = vi.fn();
const getS3AccountMock = vi.fn();
const updateS3AccountMock = vi.fn();
const createS3AccountMock = vi.fn();
const deleteS3AccountMock = vi.fn();
const importS3AccountsMock = vi.fn();

const listStorageEndpointsMock = vi.fn();
const getStorageEndpointMock = vi.fn();

const listMinimalUsersMock = vi.fn();
const listAdminTagDefinitionsMock = vi.fn();

const makeTag = (id: number, label: string, color_key = "neutral", scope = "standard") => ({
  id,
  label,
  color_key,
  scope,
});

vi.mock("./useAdminAccountStats", () => ({
  useAdminAccountStats: () => ({
    stats: null,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../api/accounts", () => ({
  listS3Accounts: (params?: unknown) => listS3AccountsMock(params),
  getS3Account: (accountId: number, options?: unknown) => getS3AccountMock(accountId, options),
  updateS3Account: (accountId: number, payload: unknown) => updateS3AccountMock(accountId, payload),
  createS3Account: (payload: unknown) => createS3AccountMock(payload),
  deleteS3Account: (accountId: number, options?: unknown) => deleteS3AccountMock(accountId, options),
  importS3Accounts: (payload: unknown) => importS3AccountsMock(payload),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
  getStorageEndpoint: (endpointId: number, options?: unknown) => getStorageEndpointMock(endpointId, options),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: () => listMinimalUsersMock(),
}));

vi.mock("../../api/tags", () => ({
  listAdminTagDefinitions: (domain: unknown) => listAdminTagDefinitionsMock(domain),
  listPrivateConnectionTagDefinitions: vi.fn(),
}));

describe("AccountsPage modal tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    localStorage.setItem("user", JSON.stringify({ id: 1, role: "ui_superadmin" }));

    listS3AccountsMock.mockResolvedValue({
      items: [
        {
          id: "RGW000000000000001",
          db_id: 1,
          name: "acc-1",
          tags: [makeTag(501, "gold", "amber")],
          rgw_account_id: "RGW000000000000001",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          user_ids: [],
          user_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    listStorageEndpointsMock.mockResolvedValue([
      {
        id: 10,
        name: "ceph-main",
        provider: "ceph",
        is_default: true,
        capabilities: {
          account: true,
          admin: true,
          usage: true,
        },
      },
    ]);

    getStorageEndpointMock.mockResolvedValue({
      id: 10,
      name: "ceph-main",
      provider: "ceph",
      is_default: true,
      capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
      admin_ops_permissions: {
        accounts_write: true,
      },
    });

    listMinimalUsersMock.mockResolvedValue([
      { id: 7, email: "ui7@example.com" },
      { id: 8, email: "ui8@example.com" },
    ]);
    listAdminTagDefinitionsMock.mockResolvedValue([makeTag(501, "gold", "amber"), makeTag(502, "prod")]);

    getS3AccountMock.mockResolvedValue({
      id: "RGW000000000000001",
      db_id: 1,
      name: "acc-1",
      tags: [makeTag(501, "gold", "amber")],
      rgw_account_id: "RGW000000000000001",
      storage_endpoint_id: 10,
      storage_endpoint_name: "ceph-main",
      storage_endpoint_url: "https://ceph.example.test",
      storage_endpoint_capabilities: {
        account: true,
        admin: true,
        usage: true,
      },
      quota_max_size_gb: null,
      quota_max_objects: null,
      user_ids: [],
      user_links: [],
    });

    updateS3AccountMock.mockResolvedValue(undefined);
    createS3AccountMock.mockResolvedValue(undefined);
    deleteS3AccountMock.mockResolvedValue(undefined);
    importS3AccountsMock.mockResolvedValue([]);
  });

  it("shows the compact empty state when no RGW accounts exist", async () => {
    listS3AccountsMock.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<AccountsPage />);

    expect(await screen.findByText("No accounts.")).toBeInTheDocument();
    expect(screen.queryByText("No accounts yet.")).not.toBeInTheDocument();
  });

  it("shows General/Linked UI users tabs and submits updated user_links", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    const generalTab = await screen.findByRole("button", { name: "General" });
    const usersTab = screen.getByRole("button", { name: "Linked UI users" });

    const tabLabels = Array.from(generalTab.parentElement?.querySelectorAll("button") ?? []).map((button) =>
      button.textContent?.trim()
    );
    expect(tabLabels.slice(0, 2)).toEqual(["General", "Linked UI users"]);
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add a tag for this account" })).toBeInTheDocument();

    fireEvent.click(usersTab);

    fireEvent.click(await screen.findByRole("button", { name: "Add UI users" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "ui7@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        tags: [expect.objectContaining({ label: "gold", color_key: "amber" })],
        user_links: expect.arrayContaining([
          expect.objectContaining({
            user_id: 7,
          }),
        ]),
      })
    );
  });

  it("edits tags inline from the general tab", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    const input = await screen.findByRole("textbox", { name: "Add a tag for this account" });
    fireEvent.focus(input);
    fireEvent.change(input, {
      target: { value: "prod" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tag prod" }));
    expect(screen.getAllByText("prod").length).toBeGreaterThan(0);

    fireEvent.change(input, {
      target: { value: "finance" },
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(screen.getAllByText("finance").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit tag gold" }));
    expect(screen.getByRole("group", { name: "Tag settings for gold" })).toBeInTheDocument();
  });

  it("does not auto-enable admin when adding a linked user", async () => {
    render(<AccountsPage />);

    await screen.findByText("acc-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Linked UI users" }));

    fireEvent.click(await screen.findByRole("button", { name: "Add UI users" }));
    const userCheckbox = await screen.findByRole("checkbox", { name: "ui7@example.com" });
    fireEvent.click(userCheckbox);
    const userRow = userCheckbox.closest("div");
    if (!userRow) {
      throw new Error("User row not found");
    }
    expect(within(userRow).getByRole("checkbox", { name: "Admin" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateS3AccountMock).toHaveBeenCalled();
    });

    const lastCall = updateS3AccountMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        tags: [expect.objectContaining({ label: "gold", color_key: "amber" })],
        user_links: expect.arrayContaining([
          expect.objectContaining({
            user_id: 7,
            account_admin: false,
          }),
        ]),
      })
    );
  });

  it("creates an account with normalized tags", async () => {
    render(<AccountsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create account" }));
    const dialog = screen.getByRole("dialog");
    const nameInput = dialog.querySelector("input[required]") as HTMLInputElement | null;
    if (!nameInput) {
      throw new Error("Account name input not found");
    }

    fireEvent.change(nameInput, { target: { value: "account-with-tags" } });
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this account" });
    fireEvent.change(tagInput, {
      target: { value: "finance" },
    });
    fireEvent.keyDown(tagInput, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Create account" })).toBeEnabled();
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(createS3AccountMock).toHaveBeenCalled();
    });
    expect(createS3AccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "account-with-tags",
        tags: [expect.objectContaining({ label: "finance", color_key: "neutral" })],
      })
    );
  });

  it("keeps tagged accounts visible with exact quick filter mode", async () => {
    listS3AccountsMock.mockImplementation((params?: { search?: string }) => {
      const taggedAccount = {
        id: "RGW000000000000001",
        db_id: 1,
        name: "acc-1",
        tags: [makeTag(501, "gold", "amber")],
        rgw_account_id: "RGW000000000000001",
        storage_endpoint_id: 10,
        storage_endpoint_name: "ceph-main",
        storage_endpoint_url: "https://ceph.example.test",
        user_ids: [],
        user_links: [],
      };
      const plainAccount = {
        id: "RGW000000000000002",
        db_id: 2,
        name: "acc-2",
        tags: [],
        rgw_account_id: "RGW000000000000002",
        storage_endpoint_id: 10,
        storage_endpoint_name: "ceph-main",
        storage_endpoint_url: "https://ceph.example.test",
        user_ids: [],
        user_links: [],
      };
      const items = params?.search === "gold" ? [taggedAccount] : [taggedAccount, plainAccount];
      return Promise.resolve({
        items,
        total: items.length,
        page: 1,
        page_size: 25,
        has_next: false,
      });
    });

    render(<AccountsPage />);

    await screen.findByText("acc-1");
    await screen.findByText("acc-2");

    fireEvent.click(screen.getByLabelText("Toggle filter match mode"));
    fireEvent.change(screen.getByPlaceholderText("Search by name, RGW ID, or tag"), {
      target: { value: "gold" },
    });

    await waitFor(() => {
      expect(listS3AccountsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: "gold",
        })
      );
    });
    expect(screen.getByText("acc-1")).toBeInTheDocument();
    expect(screen.queryByText("acc-2")).not.toBeInTheDocument();
    expect(screen.getByText("gold").parentElement?.className).toContain("text-[10px]");
  });
});

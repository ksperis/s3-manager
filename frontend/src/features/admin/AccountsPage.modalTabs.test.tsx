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

    getS3AccountMock.mockResolvedValue({
      id: "RGW000000000000001",
      db_id: 1,
      name: "acc-1",
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
        user_links: expect.arrayContaining([
          expect.objectContaining({
            user_id: 7,
          }),
        ]),
      })
    );
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
        user_links: expect.arrayContaining([
          expect.objectContaining({
            user_id: 7,
            account_admin: false,
          }),
        ]),
      })
    );
  });
});

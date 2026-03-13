import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "./UsersPage";

const listUsersMock = vi.fn();
const createUserMock = vi.fn();
const updateUserMock = vi.fn();
const assignUserToS3AccountMock = vi.fn();
const deleteUserMock = vi.fn();

const listMinimalS3AccountsMock = vi.fn();
const updateS3AccountMock = vi.fn();

const listMinimalS3UsersMock = vi.fn();
const listMinimalS3ConnectionsMock = vi.fn();

vi.mock("../../api/users", () => ({
  listUsers: (params?: unknown) => listUsersMock(params),
  createUser: (payload: unknown) => createUserMock(payload),
  updateUser: (userId: number, payload: unknown) => updateUserMock(userId, payload),
  assignUserToS3Account: (userId: number, accountId: number, role?: string, accountAdmin?: boolean) =>
    assignUserToS3AccountMock(userId, accountId, role, accountAdmin),
  deleteUser: (userId: number) => deleteUserMock(userId),
}));

vi.mock("../../api/accounts", () => ({
  listMinimalS3Accounts: () => listMinimalS3AccountsMock(),
  updateS3Account: (accountId: number, payload: unknown) => updateS3AccountMock(accountId, payload),
}));

vi.mock("../../api/s3Users", () => ({
  listMinimalS3Users: () => listMinimalS3UsersMock(),
}));

vi.mock("../../api/s3ConnectionsAdmin", () => ({
  listMinimalS3Connections: () => listMinimalS3ConnectionsMock(),
}));

describe("UsersPage modal tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    localStorage.setItem("user", JSON.stringify({ id: 1, role: "ui_superadmin" }));

    listUsersMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    listMinimalS3AccountsMock.mockResolvedValue([
      {
        id: 1,
        db_id: 1,
        name: "acc-1",
        user_ids: [],
        user_links: [],
      },
    ]);

    listMinimalS3UsersMock.mockResolvedValue([
      {
        id: 11,
        name: "s3-user-1",
      },
    ]);

    listMinimalS3ConnectionsMock.mockResolvedValue([
      {
        id: 21,
        name: "conn-1",
        owner_user_id: null,
        visibility: "shared",
        is_shared: true,
        is_public: false,
      },
    ]);

    createUserMock.mockResolvedValue({ id: 100 });
    updateUserMock.mockResolvedValue({ id: 100 });
    assignUserToS3AccountMock.mockResolvedValue(undefined);
    deleteUserMock.mockResolvedValue(undefined);
    updateS3AccountMock.mockResolvedValue(undefined);
  });

  it("keeps associations when switching General/Associations and submits linked payload", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));

    fireEvent.change(screen.getByPlaceholderText("jane.doe@example.com"), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("•••••••"), { target: { value: "secret-123" } });

    fireEvent.click(screen.getByRole("button", { name: "Associations" }));

    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "acc-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: /S3 Users \(0\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add users" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "s3-user-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: /Connections \(0\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add connections" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "conn-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Associations" }));

    expect(screen.getByRole("button", { name: /Accounts \(1\)/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalledTimes(1);
    });

    expect(assignUserToS3AccountMock).toHaveBeenCalledWith(100, 1, undefined, true);
    expect(updateUserMock).toHaveBeenCalledWith(
      100,
      expect.objectContaining({
        s3_user_ids: [11],
        s3_connection_ids: [21],
      })
    );
  });

  it("returns to General when required fields are missing and submit is triggered from Associations", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.click(screen.getByRole("button", { name: "Associations" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect((await screen.findAllByText("Email and password are required.")).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("jane.doe@example.com")).toBeInTheDocument();
  });

  it("shows Access tab and keeps access toggles out of General in create modal", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Associations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Access" })).toBeInTheDocument();
    expect(screen.queryByText("Ceph Admin access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Ops access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Access" }));
    expect(screen.getByText("Ceph Admin access")).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
  });

  it("shows Access tab and keeps access toggles out of General in edit modal", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 9,
          email: "edit.access@example.com",
          role: "ui_admin",
          accounts: [],
          account_links: [],
          s3_users: [],
          s3_connections: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Associations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Access" })).toBeInTheDocument();
    expect(screen.queryByText("Ceph Admin access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Ops access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Access" }));
    expect(screen.getByText("Ceph Admin access")).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
  });

  it("keeps role access note hidden by default in create modal and shows it on info icon click", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));

    expect(screen.queryByText("Role access summary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain role access levels" }));
    expect(screen.getByText("Role access summary")).toBeInTheDocument();
    expect(screen.getByText("Workspace access")).toBeInTheDocument();
    expect(screen.getByText("No workspace access (profile only)")).toBeInTheDocument();
    expect(screen.getByText("Non-admin workspaces only")).toBeInTheDocument();
    expect(screen.getByText("User access + /admin")).toBeInTheDocument();
    expect(screen.getByText("Admin access + /admin settings")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin and Storage Ops also require dedicated access flags.")).toBeInTheDocument();
  });

  it("keeps role access note hidden by default in edit modal and shows it on info icon click", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 7,
          email: "edit.user@example.com",
          role: "ui_user",
          accounts: [],
          account_links: [],
          s3_users: [],
          s3_connections: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.queryByText("Role access summary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain role access levels" }));
    expect(screen.getByText("Role access summary")).toBeInTheDocument();
    expect(screen.getByText("Workspace access")).toBeInTheDocument();
    expect(screen.getByText("No workspace access (profile only)")).toBeInTheDocument();
    expect(screen.getByText("Non-admin workspaces only")).toBeInTheDocument();
    expect(screen.getByText("User access + /admin")).toBeInTheDocument();
    expect(screen.getByText("Admin access + /admin settings")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin and Storage Ops also require dedicated access flags.")).toBeInTheDocument();
  });

  it("shows Storage Ops access in create modal and sends it in create payload", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));

    fireEvent.change(screen.getByPlaceholderText("jane.doe@example.com"), { target: { value: "ops@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("•••••••"), { target: { value: "secret-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Access" }));
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow access to /storage-ops" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalled();
    });
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        can_access_storage_ops: true,
      })
    );
  });
});

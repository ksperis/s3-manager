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
});

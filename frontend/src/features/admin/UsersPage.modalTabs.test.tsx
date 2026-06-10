import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const listMinimalGroupsMock = vi.fn();
const generalSettingsState = {
  manager_enabled: true,
  ceph_admin_enabled: false,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: false,
  browser_ceph_admin_enabled: true,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
  allow_user_private_connections: false,
};

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: generalSettingsState,
    loading: false,
    refresh: async () => {},
    setGeneralSettings: () => {},
  }),
}));

vi.mock("../../api/users", () => ({
  listUsers: (params?: unknown) => listUsersMock(params),
  createUser: (payload: unknown) => createUserMock(payload),
  updateUser: (userId: number, payload: unknown) => updateUserMock(userId, payload),
  assignUserToS3Account: (userId: number, accountId: number, accountAdmin?: boolean, accountRole?: string) =>
    assignUserToS3AccountMock(userId, accountId, accountAdmin, accountRole),
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

vi.mock("../../api/groups", () => ({
  listMinimalGroups: () => listMinimalGroupsMock(),
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
        created_by_user_id: 1,
        is_shared: true,
      },
    ]);

    listMinimalGroupsMock.mockResolvedValue([
      {
        id: 31,
        name: "storage-operators",
        description: "Storage operators",
      },
      {
        id: 32,
        name: "portal-readers",
        description: "Portal readers",
      },
    ]);

    createUserMock.mockResolvedValue({ id: 100 });
    updateUserMock.mockResolvedValue({ id: 100 });
    assignUserToS3AccountMock.mockResolvedValue(undefined);
    deleteUserMock.mockResolvedValue(undefined);
    updateS3AccountMock.mockResolvedValue(undefined);
  });

  it("renders associations with the shared sectioned summary", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "assoc.summary@example.com",
          role: "ui_user",
          accounts: [1],
          account_links: [{ account_id: 1, account_admin: true, account_role: "portal_user" }],
          s3_users: [11],
          s3_user_details: [{ id: 11, name: "s3-user-1" }],
          s3_connections: [21],
          s3_connection_details: [{ id: 21, name: "conn-1" }],
          group_ids: [31],
          group_details: [{ id: 31, name: "storage-operators" }],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    expect(await screen.findByText("acc-1")).toBeInTheDocument();
    expect(screen.getAllByText("Admin").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Portal user")).toBeInTheDocument();
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Connections")).toBeInTheDocument();
    expect(screen.getByText("Groups")).toBeInTheDocument();
    expect(screen.getByText("s3-user-1")).toBeInTheDocument();
    expect(screen.getByText("conn-1")).toBeInTheDocument();
    expect(screen.getByText("storage-operators")).toBeInTheDocument();
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

    expect(assignUserToS3AccountMock).toHaveBeenCalledWith(100, 1, false, "portal_none");
    expect(updateUserMock).toHaveBeenCalledWith(
      100,
      expect.objectContaining({
        s3_user_ids: [11],
        s3_connection_ids: [21],
      })
    );
  });

  it("does not retry minimal account loading in a loop after an initial failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listMinimalS3AccountsMock.mockRejectedValue(new Error("backend down"));

    render(<UsersPage />);

    await waitFor(() => {
      expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(1);
    });

    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("retries minimal account loading only on explicit modal and tab transitions after a failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listMinimalS3AccountsMock.mockRejectedValue(new Error("backend down"));

    render(<UsersPage />);

    await waitFor(() => {
      expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Associations" }));
    fireEvent.click(screen.getByRole("button", { name: /S3 Users \(0\)/ }));

    await waitFor(() => {
      expect(listMinimalS3UsersMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /Accounts \(0\)/ }));

    await waitFor(() => {
      expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(3);
    });

    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(listMinimalS3AccountsMock).toHaveBeenCalledTimes(3);

    consoleErrorSpy.mockRestore();
  });

  it("returns to General when required fields are missing and submit is triggered from Associations", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.click(screen.getByRole("button", { name: "Associations" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect((await screen.findAllByText("Email and password are required.")).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("jane.doe@example.com")).toBeInTheDocument();
  });

  it("shows Workspaces tab and keeps workspace toggles out of General in create modal", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Associations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspaces" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ceph Admin access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Ops access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Workspaces" }));
    expect(screen.getByText("Mass management workspaces")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin access")).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
  });

  it("shows Groups tab in create modal and sends group_ids in create payload", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByPlaceholderText("jane.doe@example.com"), { target: { value: "grouped@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("•••••••"), { target: { value: "secret-123" } });

    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /storage-operators/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalled();
    });
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        group_ids: [31],
      })
    );
  });

  it("shows Groups tab in edit modal and sends updated group_ids", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "edit.groups@example.com",
          role: "ui_user",
          accounts: [],
          account_links: [],
          s3_users: [],
          s3_connections: [],
          group_ids: [31],
          group_details: [{ id: 31, name: "storage-operators" }],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));

    const selectedGroup = await screen.findByRole("checkbox", { name: /storage-operators/i });
    expect(selectedGroup).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /portal-readers/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalled();
    });
    expect(updateUserMock).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        group_ids: [31, 32],
      })
    );
  });

  it("shows Workspaces tab and keeps workspace toggles out of General in edit modal", async () => {
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
    expect(screen.getByRole("button", { name: "Workspaces" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ceph Admin access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Ops access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Workspaces" }));
    expect(screen.getByText("Mass management workspaces")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin access")).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
  });

  it("shows Manager tools only in edit modal and submits per-tool access", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 10,
          email: "edit.tools@example.com",
          role: "ui_admin",
          can_access_ceph_admin: false,
          can_access_storage_ops: false,
          manager_tool_access: {
            bucket_compare: false,
            bucket_integrity_check: true,
            bucket_migration: true,
            ceph_s3_user_keys: false,
          },
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
    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    expect(screen.queryByRole("button", { name: "Manager tools" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Manager tools" }));

    expect(screen.getByText("Bucket tools")).toBeInTheDocument();
    expect(screen.getByText("Ceph tools")).toBeInTheDocument();
    const bucketToolsGroup = screen.getByText("Bucket tools").closest("div");
    expect(bucketToolsGroup).not.toBeNull();
    expect(within(bucketToolsGroup as HTMLElement).getByText("Bucket compare")).toBeInTheDocument();
    expect(within(bucketToolsGroup as HTMLElement).getByText("Bucket integrity check")).toBeInTheDocument();
    expect(within(bucketToolsGroup as HTMLElement).getByText("Bucket migration")).toBeInTheDocument();

    const compareToggle = screen.getByRole("checkbox", { name: /Bucket compare/i });
    const migrationToggle = screen.getByRole("checkbox", { name: /Bucket migration/i });
    expect(compareToggle).not.toBeChecked();
    expect(migrationToggle).toBeDisabled();
    expect(screen.getByText("Disabled globally")).toBeInTheDocument();

    fireEvent.click(compareToggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalled();
    });
    expect(updateUserMock).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        manager_tool_access: {
          bucket_compare: true,
          bucket_integrity_check: true,
          bucket_migration: true,
          ceph_s3_user_keys: false,
        },
      })
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Workspaces" }));
    expect(screen.getByText("Mass management workspaces")).toBeInTheDocument();
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

  it("allows enabling account admin when linking an account", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByPlaceholderText("jane.doe@example.com"), { target: { value: "pm@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("•••••••"), { target: { value: "secret-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Associations" }));

    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    const accountCheckbox = await screen.findByRole("checkbox", { name: "acc-1" });
    fireEvent.click(accountCheckbox);
    const accountRow = accountCheckbox.closest("div");
    if (!accountRow) {
      throw new Error("Account row not found");
    }
    fireEvent.click(within(accountRow).getByRole("checkbox", { name: "Admin" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(assignUserToS3AccountMock).toHaveBeenCalled();
    });
    expect(assignUserToS3AccountMock).toHaveBeenCalledWith(100, 1, true, "portal_none");
  });
});

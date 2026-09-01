import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "./UsersPage";
import { setSessionUserCache } from "../../utils/workspaces";

const listUsersMock = vi.fn();
const createUserMock = vi.fn();
const updateUserMock = vi.fn();
const assignUserToS3AccountMock = vi.fn();
const deleteUserMock = vi.fn();

const listMinimalS3AccountsMock = vi.fn();
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
  browser_portal_enabled: true,
  browser_ceph_admin_enabled: true,
  portal_enabled: false,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: false,
  bucket_purge_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  bucket_quota_management_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
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
  assignUserToS3Account: (userId: number, accountId: number, role: string) =>
    assignUserToS3AccountMock(userId, accountId, role),
  deleteUser: (userId: number) => deleteUserMock(userId),
}));

vi.mock("../../api/accounts", () => ({
  listMinimalS3Accounts: () => listMinimalS3AccountsMock(),
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
    window.history.replaceState({}, "", "/admin/users");

    generalSettingsState.portal_enabled = false;
    setSessionUserCache({ id: 1, role: "ui_superadmin" });

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
        name: "acc-1",
        rgw_account_id: "RGW-ACC-1",
        user_links: [],
        group_links: [],
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
  });

  it("opens the requested UI user directly in the edit page", async () => {
    window.history.replaceState({}, "", "/admin/users?edit=12&search=linked.user%40example.com");
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "linked.user@example.com",
          role: "ui_user",
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    expect(
      await screen.findByRole("heading", { name: "Edit user" }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Manage direct access, inherited associations, workspace permissions, and Manager permissions for this UI user."
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText("linked.user@example.com")).toHaveLength(2);
    expect(listUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: "linked.user@example.com" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to users" }));
    expect(window.location.search).toBe("?search=linked.user%40example.com");
  });

  it("renders associations with the shared sectioned summary", async () => {
    generalSettingsState.portal_enabled = true;
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "assoc.summary@example.com",
          role: "ui_user",
          account_links: [{ account_id: 1, role: "account_administrator" }],
          effective_access: {
            account_links: [
              {
                account_id: 1,
                role: "account_administrator",
                provenance: {
                  direct_role: "portal_user",
                  direct_determines_effective_role: false,
                  groups: [
                    {
                      group_id: 31,
                      group_name: "storage-operators",
                      role: "account_administrator",
                      determines_effective_role: true,
                    },
                  ],
                },
              },
            ],
          },
          s3_user_links: [{ s3_user_id: 11, allow_manager_browser_data_access: false }],
          s3_user_details: [{ id: 11, name: "s3-user-1" }],
          s3_connection_details: [{ id: 21, name: "conn-1" }],
          group_details: [{ id: 31, name: "storage-operators" }],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    const associations = await screen.findByLabelText("3 linked associations");
    expect(associations).toHaveAccessibleDescription(
      "Linked associations (3)\nRGW account: acc-1 — Roles: Account administrator\nRGW user: s3-user-1\nS3 connection: conn-1",
    );
    expect(screen.getByLabelText("1 accounts")).toBeInTheDocument();
    expect(screen.getByLabelText("1 rgw users")).toBeInTheDocument();
    expect(screen.getByLabelText("1 s3 connections")).toBeInTheDocument();
    expect(screen.queryByText("storage-operators")).not.toBeInTheDocument();
  });

  it("uses the responsive shared table for the user list", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "responsive.user@example.com",
          role: "ui_superadmin",
          last_login_at: "2026-07-07T08:45:56Z",
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    const table = await screen.findByRole("table");
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute(
      "placeholder",
      "Search users..."
    );
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "responsive" } });
    await waitFor(() => {
      expect(listUsersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          search: "responsive",
        })
      );
    });
    expect(table).toHaveClass("responsive-data-table");
    expect(screen.getByText("responsive.user@example.com").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("Superadmin").closest("td")).toHaveAttribute("data-label", "Role");
    expect(screen.getAllByRole("button", { name: "Edit" })[0].closest("td")).toHaveAttribute("data-mobile-actions", "true");
  });

  it("preserves an existing portal role as a disabled option when Portal is disabled", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "assoc.summary@example.com",
          role: "ui_user",
          account_links: [{ account_id: 1, role: "portal_manager" }],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);

    const associations = await screen.findByLabelText("1 linked association");
    expect(associations).toHaveAccessibleDescription(
      "Linked associations (1)\nRGW account: acc-1 — Roles: Portal manager",
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    const roleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Access role for acc-1",
    });
    expect(roleSelect).toHaveValue("portal_manager");
    expect(Array.from(roleSelect.options).map((option) => [option.value, option.disabled])).toEqual([
      ["portal_manager", true],
      ["account_administrator", false],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith(
        12,
        expect.objectContaining({
          account_links: [
            {
              account_id: 1,
              allow_manager_browser_data_access: false,
              role: "portal_manager",
            },
          ],
        })
      );
    });
    expect(assignUserToS3AccountMock).not.toHaveBeenCalled();
  });

  it("protects a root account link while allowing its advanced data access setting", async () => {
    listUsersMock.mockResolvedValue({
      items: [
        {
          id: 12,
          email: "root.link@example.com",
          role: "ui_user",
          account_links: [
            {
              account_id: 1,
              role: "account_administrator",
              is_root: true,
              allow_manager_browser_data_access: false,
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    expect(screen.getByRole("combobox", { name: "Access role for acc-1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow Manager Browser data access" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith(
        12,
        expect.objectContaining({
          account_links: [
            {
              account_id: 1,
              allow_manager_browser_data_access: true,
              role: "account_administrator",
            },
          ],
        })
      );
    });
  });

  it("keeps associations when switching General/Associations and submits linked payload", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    expect(
      screen.getByText("Configure identity, workspace access, groups, and storage associations for this UI user.")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("jane.doe@example.com"), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("•••••••"), { target: { value: "secret-123" } });

    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    const accountRoleSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Access role for acc-1",
    });
    expect(Array.from(accountRoleSelect.options).map((option) => option.value)).toEqual([
      "account_administrator",
    ]);
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

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    expect(screen.getByRole("button", { name: /Accounts \(1\)/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalledTimes(1);
    });

    expect(updateUserMock).toHaveBeenCalledWith(
      100,
      expect.objectContaining({
        account_links: [
          {
            account_id: 1,
            allow_manager_browser_data_access: false,
            role: "account_administrator",
          },
        ],
        s3_user_links: [
          {
            s3_user_id: 11,
            allow_manager_browser_data_access: false,
          },
        ],
        s3_connection_ids: [21],
      })
    );
  }, 10_000);

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

    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect((await screen.findAllByText("Email and password are required.")).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("jane.doe@example.com")).toBeInTheDocument();
  });

  it("shows Workspaces tab and keeps workspace toggles out of General in create modal", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "General",
      "Groups",
      "Associations",
      "Workspaces",
      "Connections",
      "Browser",
      "Manager",
    ]);
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Associations" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workspaces" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Browser" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ceph Admin access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Ops access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByText("Mass management workspaces")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin access")).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
  });

  it("shows Groups tab in create modal and sends group_ids in create payload", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByPlaceholderText("jane.doe@example.com"), { target: { value: "grouped@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("•••••••"), { target: { value: "secret-123" } });

    fireEvent.click(screen.getByRole("tab", { name: "Groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /storage-operators/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
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
          account_links: [],
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
    fireEvent.click(screen.getByRole("tab", { name: "Groups" }));

    expect(await screen.findByText("storage-operators")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /portal-readers/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
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
          account_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "General",
      "Groups",
      "Associations",
      "Workspaces",
      "Connections",
      "Browser",
      "Manager",
    ]);
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Associations" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workspaces" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Access" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ceph Admin access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Ops access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByText("Mass management workspaces")).toBeInTheDocument();
    expect(screen.getByText("Ceph Admin access")).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access")).toBeInTheDocument();
  });

  it("shows Connections and Manager in create/edit and submits their permissions", async () => {
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
            feature_rules: false,
          },
          account_links: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<UsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    expect(screen.getByRole("tab", { name: "Connections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Manager" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow manual private connection creation" }));
    fireEvent.click(screen.getByRole("tab", { name: "Manager" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow managed private connection provisioning" }));

    expect(screen.getByText("Bucket tools")).toBeInTheDocument();
    expect(screen.queryByText("Privileged Ceph access")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Bucket quota management" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Ceph S3 User keys" })).not.toBeInTheDocument();
    const bucketToolsGroup = screen.getByText("Bucket tools").closest("div");
    expect(bucketToolsGroup).not.toBeNull();
    expect(within(bucketToolsGroup as HTMLElement).getByText("Bucket compare")).toBeInTheDocument();
    expect(within(bucketToolsGroup as HTMLElement).getByText("Bucket integrity check")).toBeInTheDocument();
    expect(within(bucketToolsGroup as HTMLElement).getByText("Bucket migration")).toBeInTheDocument();

    const compareToggle = screen.getByRole("checkbox", { name: /Bucket compare/i });
    const migrationToggle = screen.getByRole("checkbox", { name: /Bucket migration/i });
    expect(compareToggle).not.toBeChecked();
    expect(migrationToggle).toBeDisabled();
    expect(screen.getAllByText("Disabled globally").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(compareToggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalled();
    });
    expect(updateUserMock).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        can_create_manual_private_connections: true,
        can_provision_managed_private_connections: true,
        manager_tool_access: {
          bucket_compare: true,
          bucket_integrity_check: true,
          bucket_migration: true,
          bucket_purge: false,
          feature_rules: false,
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
          account_links: [],
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
    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
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

  it("shows Browser options in create modal and sends advanced Browser access", async () => {
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByPlaceholderText("jane.doe@example.com"), { target: { value: "browser@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("•••••••"), { target: { value: "secret-123" } });

    fireEvent.click(screen.getByRole("tab", { name: "Browser" }));
    expect(screen.getByText("Browser options for this UI user. Groups can also grant these options.")).toBeInTheDocument();
    const advancedToggle = screen.getByRole("checkbox", { name: "Enable advanced Browser features" });
    expect(advancedToggle).not.toBeChecked();
    fireEvent.click(advancedToggle);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalled();
    });
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        browser_advanced_features_enabled: true,
      })
    );
  });

  it("allows choosing the canonical role while linking an account", async () => {
    generalSettingsState.portal_enabled = true;
    render(<UsersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByPlaceholderText("jane.doe@example.com"), { target: { value: "pm@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("•••••••"), { target: { value: "secret-123" } });
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    const accountCheckbox = await screen.findByRole("checkbox", { name: "acc-1" });
    fireEvent.click(accountCheckbox);
    const accountRow = accountCheckbox.closest("div");
    if (!accountRow) {
      throw new Error("Account row not found");
    }
    const roleSelect = within(accountRow).getByRole<HTMLSelectElement>("combobox", {
      name: "Access role for acc-1",
    });
    expect(Array.from(roleSelect.options).map((option) => option.value)).toEqual([
      "portal_user",
      "portal_manager",
      "account_administrator",
    ]);
    fireEvent.change(roleSelect, {
      target: { value: "portal_manager" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          account_links: [
            {
              account_id: 1,
              allow_manager_browser_data_access: false,
              role: "portal_manager",
            },
          ],
        })
      );
    });
  });
});

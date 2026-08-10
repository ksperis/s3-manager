import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GroupsPage from "./GroupsPage";

const listGroupsMock = vi.fn();
const createGroupMock = vi.fn();
const updateGroupMock = vi.fn();
const deleteGroupMock = vi.fn();
const uploadGroupAvatarMock = vi.fn();
const deleteGroupAvatarMock = vi.fn();
const listMinimalUsersMock = vi.fn();
const listMinimalS3AccountsMock = vi.fn();
const listMinimalS3UsersMock = vi.fn();
const listMinimalS3ConnectionsMock = vi.fn();

const generalSettingsState = {
  manager_enabled: true,
  ceph_admin_enabled: true,
  storage_ops_enabled: true,
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
  bucket_migration_enabled: true,
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

vi.mock("../../api/groups", () => ({
  listGroups: (params?: unknown) => listGroupsMock(params),
  createGroup: (payload: unknown) => createGroupMock(payload),
  updateGroup: (groupId: number, payload: unknown) => updateGroupMock(groupId, payload),
  deleteGroup: (groupId: number) => deleteGroupMock(groupId),
  uploadGroupAvatar: (groupId: number, file: File) => uploadGroupAvatarMock(groupId, file),
  deleteGroupAvatar: (groupId: number) => deleteGroupAvatarMock(groupId),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: () => listMinimalUsersMock(),
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

describe("GroupsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/admin/groups");
    generalSettingsState.portal_enabled = false;

    listGroupsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });
    listMinimalUsersMock.mockResolvedValue([
      { id: 2, email: "alice@example.com" },
      { id: 3, email: "bob@example.com" },
    ]);
    listMinimalS3AccountsMock.mockResolvedValue([
      { id: 1, db_id: 1, name: "acc-1", user_ids: [], user_links: [] },
    ]);
    listMinimalS3UsersMock.mockResolvedValue([{ id: 11, name: "s3-user-1" }]);
    listMinimalS3ConnectionsMock.mockResolvedValue([
      { id: 21, name: "shared-conn" },
    ]);
    createGroupMock.mockResolvedValue({ id: 50, name: "ops-group" });
    updateGroupMock.mockResolvedValue({ id: 50, name: "ops-group-updated" });
    deleteGroupMock.mockResolvedValue(undefined);
    uploadGroupAvatarMock.mockResolvedValue({ id: 50, name: "ops-group", avatar: { source: "uploaded", initials: "OG" } });
    deleteGroupAvatarMock.mockResolvedValue({ id: 50, name: "ops-group", avatar: { source: "initials", initials: "OG" } });
  });

  it("opens the requested UI group directly in the edit page", async () => {
    window.history.replaceState({}, "", "/admin/groups?edit=50&search=ops-group");
    listGroupsMock.mockResolvedValue({
      items: [
        {
          id: 50,
          name: "ops-group",
          description: null,
          user_ids: [],
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

    render(<GroupsPage />);

    expect(await screen.findByRole("heading", { name: "Edit UI group" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Manage members, storage associations, and inherited workspace permissions for this UI group."
      )
    ).toBeInTheDocument();
    expect(listGroupsMock).toHaveBeenCalledWith(expect.objectContaining({ search: "ops-group" }));

    fireEvent.click(screen.getByRole("button", { name: "Back to groups" }));
    expect(window.location.search).toBe("?search=ops-group");
  });

  it("renders association names from group details without waiting for modal resources", async () => {
    generalSettingsState.portal_enabled = true;
    listGroupsMock.mockResolvedValue({
      items: [
        {
          id: 50,
          name: "ops-group",
          description: null,
          can_access_ceph_admin: false,
          can_access_storage_ops: false,
          manager_tool_access: {
            bucket_compare: false,
            bucket_integrity_check: false,
            bucket_migration: false,
            feature_rules: false,
          },
          user_ids: [2],
          user_details: [{ id: 2, email: "alice@example.com" }],
          accounts: [99],
          account_links: [{ account_id: 99, role: "account_administrator" }],
          account_details: [{ id: 99, name: "production-account", rgw_account_id: "RGW-PROD" }],
          s3_users: [88],
          s3_user_details: [{ id: 88, name: "archive-rgw-user" }],
          s3_connections: [77],
          s3_connection_details: [{ id: 77, name: "archive-shared-connection" }],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<GroupsPage />);

    const associations = await screen.findByLabelText("3 linked associations");
    expect(associations).toHaveAccessibleDescription(
      "Linked associations (3)\nRGW account: production-account — Roles: Account administrator\nRGW user: archive-rgw-user\nS3 connection: archive-shared-connection",
    );
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute(
      "placeholder",
      "Search by group, member, account, user, or connection"
    );
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "ops" } });
    await waitFor(() => {
      expect(listGroupsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          search: "ops",
        })
      );
    });
    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(within(table).getByRole("button", { name: "ops-group" }).closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).getByText("No workspace/tool rights").closest("td")).toHaveAttribute("data-label", "Rights");
    expect(associations.closest("td")).toHaveAttribute("data-label", "Storage associations");
    const members = screen.getByLabelText("1 linked principal");
    expect(members).toHaveAccessibleDescription(
      "Linked principals (1)\nUI user: alice@example.com — Roles: User",
    );
    expect(members.closest("td")).toHaveAttribute("data-label", "Members");
    expect(screen.getByRole("link", { name: "Edit UI user alice@example.com" })).toHaveAttribute(
      "href",
      "/admin/users?edit=2&search=alice%40example.com",
    );
    expect(within(table).getByRole("button", { name: "Edit" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(screen.getByLabelText("1 accounts")).toBeInTheDocument();
    expect(screen.getByLabelText("1 rgw users")).toBeInTheDocument();
    expect(screen.getByLabelText("1 s3 connections")).toBeInTheDocument();
    expect(screen.queryByText("Account #99")).not.toBeInTheDocument();
    expect(screen.queryByText("S3 User #88")).not.toBeInTheDocument();
    expect(screen.queryByText("Connection #77")).not.toBeInTheDocument();
    expect(listMinimalS3AccountsMock).not.toHaveBeenCalled();
    expect(listMinimalS3UsersMock).not.toHaveBeenCalled();
    expect(listMinimalS3ConnectionsMock).not.toHaveBeenCalled();
  });

  it("limits visible member avatars and reports hidden members", async () => {
    const members = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      email: `member-${index + 1}@example.com`,
      role: index === 0 ? "ui_admin" : "ui_user",
      avatar: { preference: "initials" as const, source: "initials" as const, initials: `M${index + 1}` },
    }));
    listGroupsMock.mockResolvedValue({
      items: [
        {
          id: 50,
          name: "large-group",
          user_ids: members.map((member) => member.id),
          user_details: members,
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

    render(<GroupsPage />);

    const memberStack = await screen.findByLabelText("7 linked principals");
    expect(within(memberStack).getAllByRole("link")).toHaveLength(5);
    expect(within(memberStack).getByText("+2")).toBeInTheDocument();
    expect(memberStack).toHaveAccessibleDescription(/UI user: member-7@example\.com — Roles: User/);
  });

  it("hides portal role labels when portal is disabled and preserves existing group account roles", async () => {
    listGroupsMock.mockResolvedValue({
      items: [
        {
          id: 50,
          name: "ops-group",
          description: null,
          can_access_ceph_admin: false,
          can_access_storage_ops: false,
          manager_tool_access: {
            bucket_compare: false,
            bucket_integrity_check: false,
            bucket_migration: false,
            feature_rules: false,
          },
          user_ids: [],
          user_details: [],
          accounts: [99],
          account_links: [{ account_id: 99, role: "account_administrator" }],
          account_details: [{ id: 99, name: "production-account", rgw_account_id: "RGW-PROD" }],
          s3_users: [],
          s3_connections: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<GroupsPage />);

    const associations = await screen.findByLabelText("1 linked association");
    expect(associations).toHaveAccessibleDescription(
      "Linked associations (1)\nRGW account: production-account — Roles: Account administrator",
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    expect(screen.queryByText("No portal access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateGroupMock).toHaveBeenCalledTimes(1);
    });
    expect(updateGroupMock).toHaveBeenCalledWith(
      50,
      expect.objectContaining({
        account_links: [{ account_id: 99, role: "account_administrator" }],
      })
    );
  });

  it("creates a group with default rights off, members, associations, and Manager tool access", async () => {
    render(<GroupsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create group" }));
    fireEvent.change(screen.getByPlaceholderText("Storage operators"), { target: { value: "ops-group" } });

    fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByRole("checkbox", { name: "Allow group access to /ceph-admin" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Allow group access to /storage-ops" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("tab", { name: "Browser" }));
    expect(screen.getByText("Browser options inherited by group members.")).toBeInTheDocument();
    const browserAdvancedToggle = screen.getByRole("checkbox", { name: "Enable advanced Browser features" });
    expect(browserAdvancedToggle).not.toBeChecked();
    fireEvent.click(browserAdvancedToggle);

    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    fireEvent.click(screen.getByRole("button", { name: "Add UI users" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "alice@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));
    fireEvent.click(screen.getByRole("button", { name: "Add accounts" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "acc-1" }));
    expect(screen.getByRole("combobox", { name: "Access role for acc-1" })).toHaveValue(
      "account_administrator",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
    fireEvent.click(screen.getByRole("button", { name: /S3 Users \(0\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add RGW users" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "s3-user-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
    fireEvent.click(screen.getByRole("button", { name: /Connections \(0\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add S3 connections" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "shared-conn" }));
    expect(screen.queryByRole("checkbox", { name: "private-conn" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow manual private connection creation" }));

    fireEvent.click(screen.getByRole("tab", { name: "Manager" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow managed private connection provisioning" }));
    expect(screen.getByRole("checkbox", { name: "Bucket compare" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bucket integrity check" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bucket migration" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Feature rule inventory" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Bucket quota management" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Ceph S3 User keys" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Bucket compare" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Feature rule inventory" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createGroupMock).toHaveBeenCalledTimes(1);
    });
    expect(createGroupMock).toHaveBeenCalledWith({
      name: "ops-group",
      description: null,
      avatar_source: "initials",
      avatar_icon: null,
      can_access_ceph_admin: false,
      can_access_storage_ops: false,
      can_create_manual_private_connections: true,
      can_provision_managed_private_connections: true,
      browser_advanced_features_enabled: true,
      manager_tool_access: {
        bucket_compare: true,
        bucket_integrity_check: false,
        bucket_migration: false,
        bucket_purge: false,
        feature_rules: true,
      },
      user_ids: [2],
      account_links: [{ account_id: 1, role: "account_administrator" }],
      s3_user_ids: [11],
      s3_connection_ids: [21],
    });
  });

  it("uses linked rows with explicit removal for group associations", async () => {
    listGroupsMock.mockResolvedValue({
      items: [
        {
          id: 50,
          name: "ops-group",
          description: null,
          user_ids: [],
          account_links: [{ account_id: 1, role: "portal_user" }],
          account_details: [{ id: 1, name: "acc-1" }],
          s3_users: [],
          s3_connections: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<GroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("tab", { name: "Associations" }));

    expect(await screen.findByText("acc-1")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "acc-1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("No linked accounts yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateGroupMock).toHaveBeenCalledWith(
        50,
        expect.objectContaining({ account_links: [] })
      );
    });
  });

  it("lets an administrator choose a preset or upload a custom group image", async () => {
    render(<GroupsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create group" }));
    fireEvent.change(screen.getByPlaceholderText("Storage operators"), { target: { value: "visual-group" } });
    fireEvent.click(screen.getByRole("button", { name: "Use Security pictogram" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createGroupMock).toHaveBeenCalledWith(expect.objectContaining({
        name: "visual-group",
        avatar_source: "preset",
        avatar_icon: "shield",
      }));
    });

    fireEvent.click(await screen.findByRole("button", { name: "Create group" }));
    fireEvent.change(screen.getByPlaceholderText("Storage operators"), { target: { value: "uploaded-group" } });
    const file = new File(["png"], "group.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload image"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(uploadGroupAvatarMock).toHaveBeenCalledWith(50, file));
  });

  it("edits and deletes existing groups", async () => {
    listGroupsMock.mockResolvedValue({
      items: [
        {
          id: 50,
          name: "ops-group",
          description: "Initial",
          can_access_ceph_admin: false,
          can_access_storage_ops: false,
          manager_tool_access: {
            bucket_compare: false,
            bucket_integrity_check: false,
            bucket_migration: false,
            feature_rules: false,
          },
          user_ids: [2],
          user_details: [{ id: 2, email: "alice@example.com" }],
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

    render(<GroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByPlaceholderText("Storage operators"), { target: { value: "ops-group-updated" } });
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    fireEvent.click(screen.getByRole("button", { name: "Add UI users" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "bob@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateGroupMock).toHaveBeenCalledTimes(1);
    });
    expect(updateGroupMock).toHaveBeenCalledWith(
      50,
      expect.objectContaining({
        name: "ops-group-updated",
        user_ids: [2, 3],
      })
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));

    await waitFor(() => {
      expect(deleteGroupMock).toHaveBeenCalledWith(50);
    });
  });
});

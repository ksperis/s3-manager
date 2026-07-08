import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GroupsPage from "./GroupsPage";

const listGroupsMock = vi.fn();
const createGroupMock = vi.fn();
const updateGroupMock = vi.fn();
const deleteGroupMock = vi.fn();
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

vi.mock("../../api/groups", () => ({
  listGroups: (params?: unknown) => listGroupsMock(params),
  createGroup: (payload: unknown) => createGroupMock(payload),
  updateGroup: (groupId: number, payload: unknown) => updateGroupMock(groupId, payload),
  deleteGroup: (groupId: number) => deleteGroupMock(groupId),
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
      { id: 21, name: "shared-conn", is_shared: true },
      { id: 22, name: "private-conn", is_shared: false },
    ]);
    createGroupMock.mockResolvedValue({ id: 50, name: "ops-group" });
    updateGroupMock.mockResolvedValue({ id: 50, name: "ops-group-updated" });
    deleteGroupMock.mockResolvedValue(undefined);
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
            bucket_quota: false,
            ceph_s3_user_keys: false,
          },
          user_ids: [2],
          user_details: [{ id: 2, email: "alice@example.com" }],
          accounts: [99],
          account_links: [{ account_id: 99, account_admin: true, account_role: "portal_manager" }],
          account_details: [{ id: 99, name: "production-account", rgw_account_id: "RGW-PROD" }],
          s3_users: [88],
          s3_user_details: [{ id: 88, name: "archive-rgw-user" }],
          s3_connections: [77],
          s3_connection_details: [
            { id: 77, name: "archive-shared-connection", access_manager: true, access_browser: true },
          ],
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(<GroupsPage />);

    expect(await screen.findByText("production-account")).toBeInTheDocument();
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
    expect(within(table).getByText("production-account").closest("td")).toHaveAttribute("data-label", "Associations");
    expect(within(table).getByRole("button", { name: "Edit" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(screen.getAllByText("Admin").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Portal manager")).toBeInTheDocument();
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("S3 Users")).toBeInTheDocument();
    expect(screen.getByText("Connections")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("archive-rgw-user")).toBeInTheDocument();
    expect(screen.getByText("archive-shared-connection")).toBeInTheDocument();
    expect(screen.queryByText("Account #99")).not.toBeInTheDocument();
    expect(screen.queryByText("S3 User #88")).not.toBeInTheDocument();
    expect(screen.queryByText("Connection #77")).not.toBeInTheDocument();
    expect(listMinimalS3AccountsMock).not.toHaveBeenCalled();
    expect(listMinimalS3UsersMock).not.toHaveBeenCalled();
    expect(listMinimalS3ConnectionsMock).not.toHaveBeenCalled();
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
            bucket_quota: false,
            ceph_s3_user_keys: false,
          },
          user_ids: [],
          user_details: [],
          accounts: [99],
          account_links: [{ account_id: 99, account_admin: true, account_role: "portal_manager" }],
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

    expect(await screen.findByText("production-account")).toBeInTheDocument();
    expect(screen.queryByText("Portal manager")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Associations" }));

    expect(screen.queryByText("No portal access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateGroupMock).toHaveBeenCalledTimes(1);
    });
    expect(updateGroupMock).toHaveBeenCalledWith(
      50,
      expect.objectContaining({
        account_links: [{ account_id: 99, account_admin: true, account_role: "portal_manager" }],
      })
    );
  });

  it("creates a group with default rights off, members, associations, and Manager tool access", async () => {
    render(<GroupsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create group" }));
    fireEvent.change(screen.getByPlaceholderText("Storage operators"), { target: { value: "ops-group" } });

    fireEvent.click(screen.getByRole("button", { name: "Workspaces" }));
    expect(screen.getByRole("checkbox", { name: "Allow group access to /ceph-admin" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Allow group access to /storage-ops" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Browser" }));
    expect(screen.getByText("Browser options inherited by group members.")).toBeInTheDocument();
    const browserAdvancedToggle = screen.getByRole("checkbox", { name: "Enable advanced Browser features" });
    expect(browserAdvancedToggle).not.toBeChecked();
    fireEvent.click(browserAdvancedToggle);

    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "alice@example.com" }));

    fireEvent.click(screen.getByRole("button", { name: "Associations" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "acc-1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Admin" }));
    fireEvent.click(screen.getByRole("button", { name: /S3 Users \(0\)/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "s3-user-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Connections \(0\)/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "shared-conn" }));
    expect(screen.queryByRole("checkbox", { name: "private-conn" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Manager tools" }));
    expect(screen.getByRole("checkbox", { name: "Bucket compare" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bucket integrity check" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bucket migration" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Feature rule inventory" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bucket quota management" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Ceph S3 User keys" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Bucket compare" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Feature rule inventory" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createGroupMock).toHaveBeenCalledTimes(1);
    });
    expect(createGroupMock).toHaveBeenCalledWith({
      name: "ops-group",
      description: null,
      can_access_ceph_admin: false,
      can_access_storage_ops: false,
      browser_advanced_features_enabled: true,
      manager_tool_access: {
        bucket_compare: true,
        bucket_integrity_check: false,
        bucket_migration: false,
        bucket_purge: false,
        feature_rules: true,
        bucket_quota: false,
        ceph_s3_user_keys: false,
      },
      user_ids: [2],
      account_links: [{ account_id: 1, account_admin: true, account_role: "portal_none" }],
      s3_user_ids: [11],
      s3_connection_ids: [21],
    });
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
            bucket_quota: false,
            ceph_s3_user_keys: false,
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
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "bob@example.com" }));
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

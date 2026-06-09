import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  browser_ceph_admin_enabled: true,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: true,
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

  it("creates a group with default rights off, members, associations, and Manager tool access", async () => {
    render(<GroupsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Create group" }));
    fireEvent.change(screen.getByPlaceholderText("Storage operators"), { target: { value: "ops-group" } });

    fireEvent.click(screen.getByRole("button", { name: "Workspaces" }));
    expect(screen.getByRole("checkbox", { name: "Allow group access to /ceph-admin" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Allow group access to /storage-ops" })).not.toBeChecked();

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
    expect(screen.getByRole("checkbox", { name: "Ceph S3 User keys" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Bucket compare" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createGroupMock).toHaveBeenCalledTimes(1);
    });
    expect(createGroupMock).toHaveBeenCalledWith({
      name: "ops-group",
      description: null,
      can_access_ceph_admin: false,
      can_access_storage_ops: false,
      manager_tool_access: {
        bucket_compare: true,
        bucket_integrity_check: false,
        bucket_migration: false,
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

import { describe, expect, it } from "vitest";
import type { GeneralSettings } from "../api/appSettings";
import type { SessionUser } from "./workspaces";
import { resolveAvailableWorkspacesWithFlags } from "./workspaces";

const baseSettings: GeneralSettings = {
  manager_enabled: true,
  ceph_admin_enabled: true,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: false,
  browser_portal_enabled: true,
  browser_ceph_admin_enabled: true,
  allow_portal_manager_workspace: false,
  portal_enabled: false,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: true,
  bucket_compare_enabled: true,
  manager_ceph_s3_user_keys_enabled: false,
  allow_ui_user_bucket_migration: false,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
  allow_user_private_connections: false,
};

const adminUser: SessionUser = {
  id: 1,
  email: "admin@example.com",
  role: "ui_admin",
  can_access_ceph_admin: true,
  can_access_storage_ops: true,
};

describe("resolveAvailableWorkspacesWithFlags", () => {
  it("hides Storage Ops for admin-like users when feature flag is disabled", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(adminUser, {
      ...baseSettings,
      storage_ops_enabled: false,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
  });

  it("shows Storage Ops for admin-like users when feature flag is enabled", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(adminUser, {
      ...baseSettings,
      storage_ops_enabled: true,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });

  it("hides Storage Ops for admin-like users without dedicated permission", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      { ...adminUser, can_access_storage_ops: false },
      {
        ...baseSettings,
        storage_ops_enabled: true,
      }
    );
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
  });

  it("does not expose Storage Ops to standard users without dedicated permission", () => {
    const user: SessionUser = {
      id: 5,
      email: "user@example.com",
      role: "ui_user",
      can_access_storage_ops: false,
      account_links: [{ account_id: 12, account_admin: true }],
    };
    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      storage_ops_enabled: true,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
  });

  it("exposes Storage Ops to standard users with dedicated permission when feature is enabled", () => {
    const user: SessionUser = {
      id: 6,
      email: "ops-user@example.com",
      role: "ui_user",
      can_access_storage_ops: true,
      account_links: [{ account_id: 24, account_admin: false }],
    };
    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      storage_ops_enabled: true,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });
});

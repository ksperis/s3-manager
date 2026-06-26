import { afterEach, describe, expect, it } from "vitest";
import type { GeneralSettings } from "../api/appSettings";
import type { SessionUser } from "./workspaces";
import { resolveAvailableWorkspaces, resolvePostLoginPath } from "./workspaces";

const baseSettings: GeneralSettings = {
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: true,
  bucket_purge_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: false,
  manager_ceph_s3_user_keys_enabled: false,
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

const superAdminUser: SessionUser = {
  id: 2,
  email: "superadmin@example.com",
  role: "ui_superadmin",
  can_access_ceph_admin: true,
  can_access_storage_ops: true,
};

describe("resolveAvailableWorkspaces", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns English workspace labels", () => {
    const workspaces = resolveAvailableWorkspaces(adminUser, {
      ...baseSettings,
    });

    expect(workspaces.find((workspace) => workspace.id === "admin")?.label).toBe("Admin (platform)");
    expect(workspaces.find((workspace) => workspace.id === "browser")?.label).toBe("Browser (objects)");
  });

  it("shows Storage Ops for admin-like users with dedicated permission", () => {
    const workspaces = resolveAvailableWorkspaces(adminUser, {
      ...baseSettings,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });

  it("hides Storage Ops for admin-like users without dedicated permission", () => {
    const workspaces = resolveAvailableWorkspaces(
      { ...adminUser, can_access_storage_ops: false },
      {
        ...baseSettings,
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
    const workspaces = resolveAvailableWorkspaces(user, {
      ...baseSettings,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
  });

  it("exposes Storage Ops to standard users with dedicated permission", () => {
    const user: SessionUser = {
      id: 6,
      email: "ops-user@example.com",
      role: "ui_user",
      can_access_storage_ops: true,
      account_links: [{ account_id: 24, account_admin: false }],
    };
    const workspaces = resolveAvailableWorkspaces(user, {
      ...baseSettings,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });

  it("exposes Portal only for explicit portal account roles", () => {
    const user: SessionUser = {
      id: 7,
      email: "portal-user@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, account_admin: false, account_role: "portal_user" }],
    };

    const workspaces = resolveAvailableWorkspaces(user, {
      ...baseSettings,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
  });

  it("prefers effective_access for inherited account, portal, and Storage Ops access", () => {
    const user: SessionUser = {
      id: 13,
      email: "grouped-user@example.com",
      role: "ui_user",
      can_access_storage_ops: false,
      account_links: [],
      effective_access: {
        can_access_ceph_admin: false,
        can_access_storage_ops: true,
        manager_tool_access: {
          bucket_compare: false,
          bucket_integrity_check: false,
          bucket_migration: false,
          feature_rules: false,
          bucket_quota: false,
          ceph_s3_user_keys: false,
        },
        accounts: [42],
        account_links: [{ account_id: 42, account_admin: true, account_role: "portal_manager" }],
        s3_users: [],
        s3_user_details: [],
        s3_connections: [],
        s3_connection_details: [],
      },
    };

    const workspaces = resolveAvailableWorkspaces(user, {
      ...baseSettings,
    });

    expect(workspaces.some((workspace) => workspace.id === "manager")).toBe(true);
    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });

  it("prefers effective_access for inherited Browser access through shared connections", () => {
    const user: SessionUser = {
      id: 14,
      email: "grouped-browser@example.com",
      role: "ui_user",
      s3_connections: [],
      effective_access: {
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
        accounts: [],
        account_links: [],
        s3_users: [],
        s3_user_details: [],
        s3_connections: [55],
        s3_connection_details: [{ id: 55, name: "shared-browser", access_browser: true }],
      },
    };

    const workspaces = resolveAvailableWorkspaces(user, baseSettings);

    expect(workspaces.some((workspace) => workspace.id === "browser")).toBe(true);
  });

  it("exposes Portal for portal managers", () => {
    const user: SessionUser = {
      id: 9,
      email: "portal-manager@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, account_admin: false, account_role: "portal_manager" }],
    };

    const workspaces = resolveAvailableWorkspaces(user, {
      ...baseSettings,
    });

    expect(workspaces.find((workspace) => workspace.id === "portal")).toMatchObject({
      label: "Portal (self-service)",
      path: "/portal",
    });
  });

  it("exposes Browser to Portal users through Portal account access", () => {
    const user: SessionUser = {
      id: 15,
      email: "portal-browser@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, account_admin: false, account_role: "portal_user" }],
      s3_connections: [],
      s3_connection_details: [],
      s3_users: [],
      s3_user_details: [],
    };

    const workspaces = resolveAvailableWorkspaces(user, {
      ...baseSettings,
    });

    expect(workspaces.find((workspace) => workspace.id === "browser")).toMatchObject({
      label: "Browser (objects)",
      path: "/browser",
    });
  });

  it("exposes Portal for admin users with an explicit portal account role", () => {
    const workspaces = resolveAvailableWorkspaces(
      {
        ...adminUser,
        account_links: [{ account_id: 24, account_admin: true, account_role: "portal_manager" }],
      },
      {
        ...baseSettings,
      }
    );

    expect(workspaces.find((workspace) => workspace.id === "portal")).toMatchObject({
      label: "Portal (self-service)",
      path: "/portal",
    });
  });

  it("exposes Portal for superadmin users with an explicit portal account role", () => {
    const workspaces = resolveAvailableWorkspaces(
      {
        ...superAdminUser,
        account_links: [{ account_id: 24, account_admin: false, account_role: "portal_user" }],
      },
      {
        ...baseSettings,
      }
    );

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
  });

  it("does not expose Portal for admin users without an explicit portal account role", () => {
    const workspaces = resolveAvailableWorkspaces(
      {
        ...adminUser,
        account_links: [{ account_id: 24, account_admin: true, account_role: "portal_none" }],
      },
      {
        ...baseSettings,
      }
    );

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("does not expose Portal for plain account links", () => {
    const user: SessionUser = {
      id: 8,
      email: "plain-user@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, account_admin: true, account_role: "portal_none" }],
    };

    const workspaces = resolveAvailableWorkspaces(user, {
      ...baseSettings,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("does not expose Portal when the account link has no portal role", () => {
    const user: SessionUser = {
      id: 11,
      email: "missing-role@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, account_admin: true }],
    };

    const workspaces = resolveAvailableWorkspaces(user, {
      ...baseSettings,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("redirects a portal-only user to Portal", () => {
    const user: SessionUser = {
      id: 12,
      email: "portal-only@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, account_admin: false, account_role: "portal_user" }],
    };

    expect(resolvePostLoginPath(user, baseSettings)).toBe("/portal");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import type { GeneralSettings } from "../api/appSettings";
import type { SessionUser } from "./workspaces";
import { resolveAvailableWorkspacesWithFlags, resolvePostLoginPath } from "./workspaces";

const baseSettings: GeneralSettings = {
  manager_enabled: true,
  ceph_admin_enabled: true,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: false,
  browser_portal_enabled: false,
  browser_ceph_admin_enabled: true,
  portal_enabled: false,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: true,
  bucket_purge_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: false,
  bucket_quota_management_enabled: true,
  manager_ceph_s3_user_keys_enabled: false,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
};

const adminUser: SessionUser = {
  id: 1,
  email: "admin@example.com",
  role: "ui_admin",
  can_access_ceph_admin: true,
  can_access_storage_ops: true,
  account_links: [{ account_id: 1, role: "account_administrator" }],
};

const superAdminUser: SessionUser = {
  id: 2,
  email: "superadmin@example.com",
  role: "ui_superadmin",
  can_access_ceph_admin: true,
  can_access_storage_ops: true,
  account_links: [{ account_id: 2, role: "account_administrator" }],
};

describe("resolveAvailableWorkspacesWithFlags", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns English workspace labels", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(adminUser, {
      ...baseSettings,
      storage_ops_enabled: true,
    }, { manager: true, browser: true });

    expect(workspaces.find((workspace) => workspace.id === "admin")?.label).toBe("Admin (platform)");
    expect(workspaces.find((workspace) => workspace.id === "browser")?.label).toBe("Browser (objects)");
  });

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

  it("hides context workspaces for admin-like users without an authorized context", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      {
        ...adminUser,
        account_links: [],
        s3_user_details: [],
        s3_connection_details: [],
      },
      {
        ...baseSettings,
        storage_ops_enabled: true,
      },
      { manager: false, browser: false }
    );

    expect(workspaces.map((workspace) => workspace.id)).toEqual(["admin", "ceph-admin"]);
  });

  it("does not expose Storage Ops to standard users without dedicated permission", () => {
    const user: SessionUser = {
      id: 5,
      email: "user@example.com",
      role: "ui_user",
      can_access_storage_ops: false,
      account_links: [{ account_id: 12, role: "account_administrator" }],
    };
    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      storage_ops_enabled: true,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
  });

  it("does not expose Storage Ops without an authorized Manager context", () => {
    const user: SessionUser = {
      id: 16,
      email: "ops-without-context@example.com",
      role: "ui_user",
      can_access_storage_ops: true,
      account_links: [{ account_id: 24, role: "portal_user" }],
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(
      user,
      {
        ...baseSettings,
        portal_enabled: true,
        storage_ops_enabled: true,
      },
      { manager: false, browser: true }
    );

    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(false);
    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
    expect(workspaces.some((workspace) => workspace.id === "browser")).toBe(true);
  });

  it("exposes Storage Ops to standard users with dedicated permission when feature is enabled", () => {
    const user: SessionUser = {
      id: 6,
      email: "ops-user@example.com",
      role: "ui_user",
      can_access_storage_ops: true,
      account_links: [{ account_id: 24, role: "account_administrator" }],
    };
    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      storage_ops_enabled: true,
    });
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });

  it("exposes Portal only for explicit portal account roles when feature is enabled", () => {
    const user: SessionUser = {
      id: 7,
      email: "portal-user@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, role: "portal_user" }],
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
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
        },
        account_links: [{
          account_id: 42,
          role: "account_administrator",
          provenance: {
            direct_role: null,
            direct_determines_effective_role: false,
            groups: [],
          },
        }],
        s3_user_details: [],
        s3_connection_details: [],
      },
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
      storage_ops_enabled: true,
    });

    expect(workspaces.some((workspace) => workspace.id === "manager")).toBe(true);
    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
    expect(workspaces.some((workspace) => workspace.id === "storage-ops")).toBe(true);
  });

  it("does not infer Browser access from shared connections", () => {
    const user: SessionUser = {
      id: 14,
      email: "grouped-browser@example.com",
      role: "ui_user",
      effective_access: {
        can_access_ceph_admin: false,
        can_access_storage_ops: false,
        manager_tool_access: {
          bucket_compare: false,
          bucket_integrity_check: false,
          bucket_migration: false,
          feature_rules: false,
        },
        account_links: [],
        s3_user_details: [],
        s3_connection_details: [{ id: 55, name: "shared-browser" }],
      },
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, baseSettings);

    expect(workspaces.some((workspace) => workspace.id === "browser")).toBe(false);
  });

  it("exposes Portal for portal managers when feature is enabled", () => {
    const user: SessionUser = {
      id: 9,
      email: "portal-manager@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, role: "portal_manager" }],
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
    });

    expect(workspaces.find((workspace) => workspace.id === "portal")).toMatchObject({
      label: "Portal (self-service)",
      path: "/portal",
    });
  });

  it("does not expose standard Browser to Portal-only users", () => {
    const user: SessionUser = {
      id: 15,
      email: "portal-browser@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, role: "portal_user" }],
      s3_connection_details: [],
      s3_user_details: [],
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      browser_root_enabled: false,
      portal_enabled: true,
      browser_portal_enabled: true,
    });

    expect(workspaces.some((workspace) => workspace.id === "browser")).toBe(false);
  });

  it("exposes Portal for admin users with an explicit portal account role", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      {
        ...adminUser,
        account_links: [{ account_id: 24, role: "account_administrator" }],
      },
      {
        ...baseSettings,
        portal_enabled: true,
      }
    );

    expect(workspaces.find((workspace) => workspace.id === "portal")).toMatchObject({
      label: "Portal (self-service)",
      path: "/portal",
    });
  });

  it("exposes Portal for superadmin users with an explicit portal account role", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      {
        ...superAdminUser,
        account_links: [{ account_id: 24, role: "portal_user" }],
      },
      {
        ...baseSettings,
        portal_enabled: true,
      }
    );

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(true);
  });

  it("does not expose Portal for admin users without an explicit portal account role", () => {
    const workspaces = resolveAvailableWorkspacesWithFlags(
      {
        ...adminUser,
        account_links: [],
      },
      {
        ...baseSettings,
        portal_enabled: true,
      }
    );

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("does not expose Portal when the feature flag is disabled", () => {
    const user: SessionUser = {
      id: 10,
      email: "portal-disabled@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, role: "portal_user" }],
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: false,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("does not expose Portal for plain account links", () => {
    const user: SessionUser = {
      id: 8,
      email: "plain-user@example.com",
      role: "ui_user",
      account_links: [],
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("does not expose Portal when the account link has no portal role", () => {
    const user: SessionUser = {
      id: 11,
      email: "missing-role@example.com",
      role: "ui_user",
      account_links: [],
    };

    const workspaces = resolveAvailableWorkspacesWithFlags(user, {
      ...baseSettings,
      portal_enabled: true,
    });

    expect(workspaces.some((workspace) => workspace.id === "portal")).toBe(false);
  });

  it("redirects a portal-only user to Portal", () => {
    const user: SessionUser = {
      id: 12,
      email: "portal-only@example.com",
      role: "ui_user",
      account_links: [{ account_id: 24, role: "portal_user" }],
    };

    expect(resolvePostLoginPath(user, { ...baseSettings, portal_enabled: true })).toBe("/portal");
  });
});

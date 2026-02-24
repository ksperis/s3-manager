/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { GeneralSettings } from "../api/appSettings";

export const WORKSPACE_STORAGE_KEY = "selectedWorkspace";

const SUPERADMIN_ROLE = "ui_superadmin";
const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";

export type WorkspaceId = "admin" | "ceph-admin" | "manager" | "browser" | "portal";

export type WorkspaceOption = {
  id: WorkspaceId;
  label: string;
  path: string;
};

export type SessionUser = {
  id?: number | null;
  email?: string | null;
  role?: string | null;
  ui_language?: "en" | "fr" | "de" | null;
  can_access_ceph_admin?: boolean | null;
  authType?: "password" | "s3_session" | "oidc" | null;
  account_links?: { account_id: number; account_role?: string | null; account_admin?: boolean | null }[] | null;
  s3_users?: number[] | null;
  s3_user_details?: { id: number; name?: string | null }[] | null;
  s3_connections?: number[] | null;
  s3_connection_details?: { id: number; name?: string | null; iam_capable?: boolean | null }[] | null;
  capabilities?: {
    can_manage_buckets?: boolean;
    can_manage_iam?: boolean;
  };
};

const ALL_WORKSPACES: WorkspaceOption[] = [
  { id: "admin", label: "Admin (plateforme)", path: "/admin" },
  { id: "ceph-admin", label: "Ceph Admin (RGW)", path: "/ceph-admin" },
  { id: "manager", label: "Manager (admin tenant)", path: "/manager" },
  { id: "browser", label: "Browser (objets)", path: "/browser" },
  { id: "portal", label: "Portail (self-service)", path: "/portal" },
];

export function isSuperAdminRole(role?: string | null): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  return normalized === SUPERADMIN_ROLE || normalized === "super_admin" || normalized === "superadmin";
}

export function isAdminLikeRole(role?: string | null): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  return normalized === ADMIN_ROLE || isSuperAdminRole(normalized);
}

export function readStoredUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function readStoredWorkspaceId(): WorkspaceId | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (stored === "admin" || stored === "ceph-admin" || stored === "manager" || stored === "browser" || stored === "portal") {
    return stored;
  }
  return null;
}

function resolveAvailableWorkspaces(user: SessionUser | null): WorkspaceOption[] {
  if (!user || !user.role) return [];
  if (isAdminLikeRole(user.role)) {
    return ALL_WORKSPACES.filter((workspace) => workspace.id !== "ceph-admin" || Boolean(user.can_access_ceph_admin));
  }
  if (user.role !== USER_ROLE) return [];
  if (user.authType === "s3_session") {
    const canManager = user.capabilities?.can_manage_iam !== false;
    const canBrowser = user.capabilities?.can_manage_buckets !== false;
    return ALL_WORKSPACES.filter((workspace) => {
      if (workspace.id === "manager") return canManager;
      if (workspace.id === "browser") return canBrowser;
      return false;
    });
  }
  const links = user.account_links ?? [];
  const s3UserDetails = user.s3_user_details ?? [];
  const s3UserIds = user.s3_users ?? [];
  const connectionDetails = user.s3_connection_details ?? [];
  const connectionIds = user.s3_connections ?? [];
  const hasPortalAccess = links.some(
    (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
  );
  const hasAccountAdmin = links.some((link) => Boolean(link.account_admin));
  const hasPortalManagerRole = links.some((link) => link.account_role === "portal_manager");
  const hasS3UserAccess = s3UserDetails.length > 0 || s3UserIds.length > 0;
  const hasBrowserConnectionAccess = connectionDetails.length > 0 || connectionIds.length > 0;
  const hasManagerConnectionAccess =
    connectionDetails.length > 0
      ? connectionDetails.some((connection) => connection.iam_capable !== false)
      : connectionIds.length > 0;
  const hasManagerAccess = hasAccountAdmin || hasManagerConnectionAccess || hasPortalManagerRole || hasS3UserAccess;
  const hasBrowserAccess = hasBrowserConnectionAccess || hasS3UserAccess;

  return ALL_WORKSPACES.filter((workspace) => {
    if (workspace.id === "portal") return hasPortalAccess;
    if (workspace.id === "manager") return hasManagerAccess;
    if (workspace.id === "browser") return hasBrowserAccess;
    return false;
  });
}

export function resolveAvailableWorkspacesWithFlags(
  user: SessionUser | null,
  generalSettings: GeneralSettings
): WorkspaceOption[] {
  const filtered = resolveAvailableWorkspaces(user).filter((workspace) => {
    if (workspace.id === "ceph-admin") return generalSettings.ceph_admin_enabled;
    if (workspace.id === "manager") {
      if (!generalSettings.manager_enabled) return false;
      if (user?.role !== USER_ROLE || user?.authType === "s3_session") return true;
      if (user.account_links?.some((link) => Boolean(link.account_admin))) return true;
      const hasIamConnections = user.s3_connection_details && user.s3_connection_details.length > 0
        ? user.s3_connection_details.some((connection) => connection.iam_capable !== false)
        : Boolean(user.s3_connections && user.s3_connections.length > 0);
      if (hasIamConnections) return true;
      if (user.s3_user_details?.length || user.s3_users?.length) return true;
      return Boolean(
        generalSettings.allow_portal_manager_workspace &&
          user.account_links?.some((link) => link.account_role === "portal_manager")
      );
    }
    if (workspace.id === "browser") return generalSettings.browser_enabled && generalSettings.browser_root_enabled;
    if (workspace.id === "portal") return generalSettings.portal_enabled;
    return true;
  });
  return filtered;
}

export function resolveWorkspaceFromPath(pathname: string, options: WorkspaceOption[]): WorkspaceOption | null {
  const segment = pathname.split("/")[1] || "";
  const active = options.find((option) => option.id === segment);
  return active ?? null;
}

export function resolveRoleHomePath(user: SessionUser | null, generalSettings: GeneralSettings): string {
  if (!user || !user.role) return "/login";
  if (isAdminLikeRole(user.role)) return "/admin";
  if (user.role !== USER_ROLE) return "/unauthorized";
  if (user.authType === "s3_session") {
    const canManager = user.capabilities?.can_manage_iam !== false;
    const canBrowser = user.capabilities?.can_manage_buckets !== false;
    if (generalSettings.manager_enabled && canManager) return "/manager";
    if (generalSettings.browser_enabled && generalSettings.browser_root_enabled && canBrowser) {
      return "/browser";
    }
    return "/unauthorized";
  }
  const links = user.account_links ?? [];
  const s3UserDetails = user.s3_user_details ?? [];
  const s3UserIds = user.s3_users ?? [];
  const connectionDetails = user.s3_connection_details ?? [];
  const connectionIds = user.s3_connections ?? [];
  const hasPortalAccess = links.some(
    (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
  );
  const hasAccountAdmin = links.some((link) => Boolean(link.account_admin));
  const hasPortalManager = links.some((link) => link.account_role === "portal_manager");
  const hasS3UserAccess = s3UserDetails.length > 0 || s3UserIds.length > 0;
  const hasBrowserAccess = connectionDetails.length > 0 || connectionIds.length > 0 || hasS3UserAccess;
  const hasManagerConnectionAccess =
    connectionDetails.length > 0
      ? connectionDetails.some((connection) => connection.iam_capable !== false)
      : connectionIds.length > 0;
  const hasManagerAccess =
    hasAccountAdmin ||
    hasManagerConnectionAccess ||
    hasS3UserAccess ||
    (generalSettings.allow_portal_manager_workspace && hasPortalManager);

  if (generalSettings.manager_enabled && hasManagerAccess) return "/manager";
  if (hasPortalAccess && generalSettings.portal_enabled) return "/portal";
  if (generalSettings.browser_enabled && generalSettings.browser_root_enabled && hasBrowserAccess) return "/browser";
  return "/unauthorized";
}

export function resolvePostLoginPath(user: SessionUser | null, generalSettings: GeneralSettings): string {
  const fallbackPath = resolveRoleHomePath(user, generalSettings);
  if (fallbackPath === "/login" || fallbackPath === "/unauthorized") {
    return fallbackPath;
  }
  const availableWorkspaces = resolveAvailableWorkspacesWithFlags(user, generalSettings);
  const preferredWorkspaceId = readStoredWorkspaceId();
  if (preferredWorkspaceId) {
    const preferred = availableWorkspaces.find((workspace) => workspace.id === preferredWorkspaceId);
    if (preferred) {
      return preferred.path;
    }
  }
  return fallbackPath;
}

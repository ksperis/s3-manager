/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { GeneralSettings } from "../api/appSettings";

export const WORKSPACE_STORAGE_KEY = "selectedWorkspace";

const SUPERADMIN_ROLE = "ui_superadmin";
const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";

export type WorkspaceId = "admin" | "ceph-admin" | "storage-ops" | "manager" | "browser" | "portal";

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
  can_access_storage_ops?: boolean | null;
  authType?: "password" | "s3_session" | "oidc" | null;
  account_links?: { account_id: number; account_role?: string | null; account_admin?: boolean | null }[] | null;
  s3_users?: number[] | null;
  s3_user_details?: { id: number; name?: string | null }[] | null;
  s3_connections?: number[] | null;
  s3_connection_details?: {
    id: number;
    name?: string | null;
    access_manager?: boolean | null;
    access_browser?: boolean | null;
  }[] | null;
  capabilities?: {
    can_manage_buckets?: boolean;
    can_manage_iam?: boolean;
    access_browser?: boolean;
  };
};

const ALL_WORKSPACES: WorkspaceOption[] = [
  { id: "admin", label: "Admin (plateforme)", path: "/admin" },
  { id: "ceph-admin", label: "Ceph Admin (RGW)", path: "/ceph-admin" },
  { id: "storage-ops", label: "Storage Ops", path: "/storage-ops" },
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
  if (
    stored === "admin" ||
    stored === "ceph-admin" ||
    stored === "storage-ops" ||
    stored === "manager" ||
    stored === "browser" ||
    stored === "portal"
  ) {
    return stored;
  }
  return null;
}

function resolveAvailableWorkspaces(user: SessionUser | null): WorkspaceOption[] {
  if (!user || !user.role) return [];
  if (isAdminLikeRole(user.role)) {
    return ALL_WORKSPACES.filter((workspace) => {
      if (workspace.id === "ceph-admin") return Boolean(user.can_access_ceph_admin);
      if (workspace.id === "storage-ops") return Boolean(user.can_access_storage_ops);
      return true;
    });
  }
  if (user.role !== USER_ROLE) return [];
  if (user.authType === "s3_session") {
    const canManager = user.capabilities?.can_manage_iam !== false;
    const canBrowser = user.capabilities?.access_browser !== false;
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
  const canUseManagerConnection = (connection: { access_manager?: boolean | null }) =>
    connection.access_manager === true;
  const canUseBrowserConnection = (connection: { access_browser?: boolean | null }) =>
    connection.access_browser !== false;
  const hasPortalAccess = links.some(
    (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
  );
  const hasAccountAdmin = links.some((link) => Boolean(link.account_admin));
  const hasS3UserAccess = s3UserDetails.length > 0 || s3UserIds.length > 0;
  const hasBrowserConnectionAccess =
    connectionDetails.length > 0
      ? connectionDetails.some((connection) => canUseBrowserConnection(connection))
      : connectionIds.length > 0;
  const hasManagerConnectionAccess =
    connectionDetails.length > 0
      ? connectionDetails.some((connection) => canUseManagerConnection(connection))
      : connectionIds.length > 0;
  const hasManagerAccess = hasAccountAdmin || hasManagerConnectionAccess || hasS3UserAccess;
  const hasBrowserAccess = hasBrowserConnectionAccess || hasS3UserAccess;

  return ALL_WORKSPACES.filter((workspace) => {
    if (workspace.id === "storage-ops") return Boolean(user.can_access_storage_ops);
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
    if (workspace.id === "storage-ops") return generalSettings.storage_ops_enabled;
    if (workspace.id === "manager") {
      if (!generalSettings.manager_enabled) return false;
      if (user?.role !== USER_ROLE || user?.authType === "s3_session") return true;
      if (user.account_links?.some((link) => Boolean(link.account_admin))) return true;
      const hasIamConnections = user.s3_connection_details && user.s3_connection_details.length > 0
        ? user.s3_connection_details.some((connection) =>
            connection.access_manager === true
          )
        : Boolean(user.s3_connections && user.s3_connections.length > 0);
      if (hasIamConnections) return true;
      if (user.s3_user_details?.length || user.s3_users?.length) return true;
      return false;
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
    const canBrowser = user.capabilities?.access_browser !== false;
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
  const canUseManagerConnection = (connection: { access_manager?: boolean | null }) =>
    connection.access_manager === true;
  const canUseBrowserConnection = (connection: { access_browser?: boolean | null }) =>
    connection.access_browser !== false;
  const hasPortalAccess = links.some(
    (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
  );
  const hasAccountAdmin = links.some((link) => Boolean(link.account_admin));
  const hasS3UserAccess = s3UserDetails.length > 0 || s3UserIds.length > 0;
  const hasBrowserConnectionAccess =
    connectionDetails.length > 0
      ? connectionDetails.some((connection) => canUseBrowserConnection(connection))
      : connectionIds.length > 0;
  const hasBrowserAccess = hasBrowserConnectionAccess || hasS3UserAccess;
  const hasManagerConnectionAccess =
    connectionDetails.length > 0
      ? connectionDetails.some((connection) => canUseManagerConnection(connection))
      : connectionIds.length > 0;
  const hasManagerAccess =
    hasAccountAdmin ||
    hasManagerConnectionAccess ||
    hasS3UserAccess;

  if (generalSettings.manager_enabled && hasManagerAccess) return "/manager";
  if (generalSettings.storage_ops_enabled && Boolean(user.can_access_storage_ops)) return "/storage-ops";
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

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { GeneralSettings } from "../api/appSettings";
import type { EffectiveUserAccess, ManagerToolAccess, UiPreferences, UserAvatarDescriptor } from "../api/users";
import { CLIENT_STORAGE_KEYS, readClientJson, readClientStorage } from "./clientStorage";

export const WORKSPACE_STORAGE_KEY = CLIENT_STORAGE_KEYS.selectedWorkspace;
export const SESSION_USER_UPDATED_EVENT = "s3-manager:session-user-updated";

const SUPERADMIN_ROLE = "ui_superadmin";
const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";

export type WorkspaceId = "admin" | "ceph-admin" | "storage-ops" | "manager" | "portal" | "browser";

export type WorkspaceOption = {
  id: WorkspaceId;
  label: string;
  path: string;
};

export type SessionUser = {
  id?: number | null;
  email?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  avatar?: UserAvatarDescriptor | null;
  role?: string | null;
  ui_language?: "en" | "fr" | "de" | null;
  ui_preferences?: UiPreferences | null;
  can_access_ceph_admin?: boolean | null;
  can_access_storage_ops?: boolean | null;
  manager_tool_access?: ManagerToolAccess | null;
  browser_advanced_features_enabled?: boolean | null;
  effective_access?: EffectiveUserAccess | null;
  authType?: "password" | "s3_session" | "oidc" | "ldap" | null;
  actorType?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  account_links?: {
    account_id: number;
    account_admin?: boolean | null;
    account_role?: "portal_none" | "portal_user" | "portal_manager" | string | null;
  }[] | null;
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
  { id: "admin", label: "Admin (platform)", path: "/admin" },
  { id: "ceph-admin", label: "Ceph Admin (RGW)", path: "/ceph-admin" },
  { id: "storage-ops", label: "Storage Ops", path: "/storage-ops" },
  { id: "manager", label: "Manager (admin tenant)", path: "/manager" },
  { id: "portal", label: "Portal (self-service)", path: "/portal" },
  { id: "browser", label: "Browser (objects)", path: "/browser" },
];

export function isSuperAdminRole(role?: string | null): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  return normalized === SUPERADMIN_ROLE || normalized === "super_admin" || normalized === "superadmin";
}

export function isAdminLikeRole(role?: string | null): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  return normalized === ADMIN_ROLE || isSuperAdminRole(normalized);
}

export function isManagerToolRole(role?: string | null): boolean {
  return isAdminLikeRole(role) || role === USER_ROLE;
}

export function getManagerToolAccess(user: SessionUser | null): ManagerToolAccess | null {
  return user?.effective_access?.manager_tool_access ?? user?.manager_tool_access ?? null;
}

export function readStoredUser(): SessionUser | null {
  return readClientJson<SessionUser>(CLIENT_STORAGE_KEYS.sessionUser);
}

export function readStoredWorkspaceId(): WorkspaceId | null {
  const stored = readClientStorage(WORKSPACE_STORAGE_KEY);
  if (
    stored === "admin" ||
    stored === "ceph-admin" ||
    stored === "storage-ops" ||
    stored === "manager" ||
    stored === "portal" ||
    stored === "browser"
  ) {
    return stored;
  }
  return null;
}

export function hasPortalWorkspaceAccess(user: SessionUser | null): boolean {
  const links = getAccountLinks(user);
  return Boolean(
    links.some(
      (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
    )
  );
}

function getEffectiveAccess(user: SessionUser | null): EffectiveUserAccess | null {
  return user?.effective_access ?? null;
}

function getAccountLinks(user: SessionUser | null): NonNullable<SessionUser["account_links"]> {
  return getEffectiveAccess(user)?.account_links ?? user?.account_links ?? [];
}

function getS3UserIds(user: SessionUser | null): number[] {
  return getEffectiveAccess(user)?.s3_users ?? user?.s3_users ?? [];
}

function getS3UserDetails(user: SessionUser | null): NonNullable<SessionUser["s3_user_details"]> {
  return getEffectiveAccess(user)?.s3_user_details ?? user?.s3_user_details ?? [];
}

function getConnectionIds(user: SessionUser | null): number[] {
  return getEffectiveAccess(user)?.s3_connections ?? user?.s3_connections ?? [];
}

function getConnectionDetails(user: SessionUser | null): NonNullable<SessionUser["s3_connection_details"]> {
  return getEffectiveAccess(user)?.s3_connection_details ?? user?.s3_connection_details ?? [];
}

function canAccessCephAdmin(user: SessionUser | null): boolean {
  return Boolean(getEffectiveAccess(user)?.can_access_ceph_admin ?? user?.can_access_ceph_admin);
}

function canAccessStorageOps(user: SessionUser | null): boolean {
  return Boolean(getEffectiveAccess(user)?.can_access_storage_ops ?? user?.can_access_storage_ops);
}

function resolveAvailableWorkspaces(user: SessionUser | null): WorkspaceOption[] {
  if (!user || !user.role) return [];
  const links = getAccountLinks(user);
  const hasPortalAccess = hasPortalWorkspaceAccess(user);
  if (isAdminLikeRole(user.role)) {
    return ALL_WORKSPACES.filter((workspace) => {
      if (workspace.id === "ceph-admin") return canAccessCephAdmin(user);
      if (workspace.id === "storage-ops") return canAccessStorageOps(user);
      if (workspace.id === "portal") return hasPortalAccess;
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
  const s3UserDetails = getS3UserDetails(user);
  const s3UserIds = getS3UserIds(user);
  const connectionDetails = getConnectionDetails(user);
  const connectionIds = getConnectionIds(user);
  const canUseManagerConnection = (connection: { access_manager?: boolean | null }) =>
    connection.access_manager === true;
  const canUseBrowserConnection = (connection: { access_browser?: boolean | null }) =>
    connection.access_browser !== false;
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
  const hasBrowserAccess = hasBrowserConnectionAccess || hasS3UserAccess || hasPortalAccess;

  return ALL_WORKSPACES.filter((workspace) => {
    if (workspace.id === "storage-ops") return canAccessStorageOps(user);
    if (workspace.id === "manager") return hasManagerAccess;
    if (workspace.id === "portal") return hasPortalAccess;
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
    if (workspace.id === "portal") return generalSettings.portal_enabled;
    if (workspace.id === "manager") {
      if (!generalSettings.manager_enabled) return false;
      if (user?.role !== USER_ROLE || user?.authType === "s3_session") return true;
      if (getAccountLinks(user).some((link) => Boolean(link.account_admin))) return true;
      const connectionDetails = getConnectionDetails(user);
      const hasIamConnections = connectionDetails.length > 0
        ? connectionDetails.some((connection) =>
            connection.access_manager === true
          )
        : getConnectionIds(user).length > 0;
      if (hasIamConnections) return true;
      if (getS3UserDetails(user).length || getS3UserIds(user).length) return true;
      return false;
    }
    if (workspace.id === "browser") {
      const portalBrowserEnabled =
        generalSettings.portal_enabled &&
        generalSettings.browser_portal_enabled &&
        hasPortalWorkspaceAccess(user);
      return generalSettings.browser_enabled && (generalSettings.browser_root_enabled || portalBrowserEnabled);
    }
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
  const links = getAccountLinks(user);
  const hasPortalAccess = hasPortalWorkspaceAccess(user);
  const s3UserDetails = getS3UserDetails(user);
  const s3UserIds = getS3UserIds(user);
  const connectionDetails = getConnectionDetails(user);
  const connectionIds = getConnectionIds(user);
  const canUseManagerConnection = (connection: { access_manager?: boolean | null }) =>
    connection.access_manager === true;
  const canUseBrowserConnection = (connection: { access_browser?: boolean | null }) =>
    connection.access_browser !== false;
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
  if (generalSettings.storage_ops_enabled && canAccessStorageOps(user)) return "/storage-ops";
  if (generalSettings.portal_enabled && hasPortalAccess) return "/portal";
  if (
    generalSettings.browser_enabled &&
    (
      (generalSettings.browser_root_enabled && hasBrowserAccess) ||
      (generalSettings.portal_enabled && generalSettings.browser_portal_enabled && hasPortalAccess)
    )
  ) {
    return "/browser";
  }
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

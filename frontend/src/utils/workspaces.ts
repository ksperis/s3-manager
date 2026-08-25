/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { GeneralSettings } from "../api/appSettings";
import type { AccountAccessRole } from "../api/accountRoles";
import type { WorkspaceAccess } from "../api/executionContexts";
import type {
  EffectiveUserAccess,
  ManagerToolAccess,
  UiPreferences,
  UiRole,
  UserAvatarDescriptor,
} from "../api/users";
import { CLIENT_STORAGE_KEYS, readClientStorage } from "./clientStorage";

export const WORKSPACE_STORAGE_KEY = CLIENT_STORAGE_KEYS.selectedWorkspace;
export const SESSION_USER_UPDATED_EVENT = "bucketreef:session-user-updated";
let sessionUserCache: SessionUser | null = null;

const SUPERADMIN_ROLE = "ui_superadmin";
const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";

export type WorkspaceId = "admin" | "ceph-admin" | "storage-ops" | "manager" | "portal" | "browser";

type WorkspaceOption = {
  id: WorkspaceId;
  label: string;
  path: string;
};

export type WorkspaceContextAvailability = {
  manager: boolean;
  browser: boolean;
  portal?: boolean;
};

export type SessionUser = {
  id?: number | null;
  email?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  avatar?: UserAvatarDescriptor | null;
  role?: UiRole | null;
  ui_language?: "en" | "fr" | "de" | null;
  ui_preferences?: UiPreferences | null;
  can_access_ceph_admin?: boolean | null;
  can_access_storage_ops?: boolean | null;
  can_create_manual_private_connections?: boolean | null;
  can_provision_managed_private_connections?: boolean | null;
  manager_tool_access?: ManagerToolAccess | null;
  browser_advanced_features_enabled?: boolean | null;
  effective_access?: EffectiveUserAccess | null;
  authType?: "password" | "s3_session" | "oidc" | "ldap" | null;
  actorType?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  account_links?: {
    account_id: number;
    role: AccountAccessRole;
  }[] | null;
  s3_user_details?: { id: number; name?: string | null }[] | null;
  s3_connection_details?: {
    id: number;
    name?: string | null;
  }[] | null;
  capabilities?: {
    can_manage_buckets?: boolean;
    can_manage_iam?: boolean;
    access_browser?: boolean;
  };
};

type PrivateConnectionAccessUser = {
  can_create_manual_private_connections?: boolean | null;
  can_provision_managed_private_connections?: boolean | null;
  effective_access?: Pick<
    EffectiveUserAccess,
    | "can_create_manual_private_connections"
    | "can_provision_managed_private_connections"
    | "has_owned_private_connections"
  > | null;
};

const ALL_WORKSPACES: WorkspaceOption[] = [
  { id: "admin", label: "Admin (platform)", path: "/admin" },
  { id: "ceph-admin", label: "Ceph Admin (RGW)", path: "/ceph-admin" },
  { id: "storage-ops", label: "Storage Ops", path: "/storage-ops" },
  { id: "manager", label: "Manager (admin tenant)", path: "/manager" },
  { id: "portal", label: "Portal (self-service)", path: "/portal" },
  { id: "browser", label: "Browser (objects)", path: "/browser" },
];

export function isSuperAdminRole(role?: UiRole | null): boolean {
  return role === SUPERADMIN_ROLE;
}

export function isAdminLikeRole(role?: UiRole | null): boolean {
  return role === ADMIN_ROLE || isSuperAdminRole(role);
}

export function getManagerToolAccess(user: SessionUser | null): ManagerToolAccess | null {
  return user?.effective_access?.manager_tool_access ?? user?.manager_tool_access ?? null;
}

export function canCreateManualPrivateConnections(user: PrivateConnectionAccessUser | null): boolean {
  return Boolean(
    user?.effective_access?.can_create_manual_private_connections ??
      user?.can_create_manual_private_connections
  );
}

function hasOwnedPrivateConnections(user: PrivateConnectionAccessUser | null): boolean {
  return Boolean(user?.effective_access?.has_owned_private_connections);
}

export function canAccessPrivateConnectionsSection(user: PrivateConnectionAccessUser | null): boolean {
  return canCreateManualPrivateConnections(user) || hasOwnedPrivateConnections(user);
}

export function readStoredUser(): SessionUser | null {
  return sessionUserCache;
}

export function setSessionUserCache(user: SessionUser | null): void {
  sessionUserCache = user;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_USER_UPDATED_EVENT));
  }
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
      (link) => ["portal_user", "portal_manager", "account_administrator"].includes(link.role)
    )
  );
}

function getEffectiveAccess(user: SessionUser | null): EffectiveUserAccess | null {
  return user?.effective_access ?? null;
}

function getAccountLinks(user: SessionUser | null): NonNullable<SessionUser["account_links"]> {
  return getEffectiveAccess(user)?.account_links ?? user?.account_links ?? [];
}

function getS3UserDetails(user: SessionUser | null): NonNullable<SessionUser["s3_user_details"]> {
  return getEffectiveAccess(user)?.s3_user_details ?? user?.s3_user_details ?? [];
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

function resolveAvailableWorkspaces(
  user: SessionUser | null,
  contextAvailability?: WorkspaceContextAvailability
): WorkspaceOption[] {
  if (!user || !user.role) return [];
  const links = getAccountLinks(user);
  const hasPortalAccess = hasPortalWorkspaceAccess(user);
  if (user.authType === "s3_session") {
    if (user.role !== USER_ROLE) return [];
    const canManager = user.capabilities?.can_manage_iam !== false;
    const canBrowser = user.capabilities?.access_browser !== false;
    return ALL_WORKSPACES.filter((workspace) => {
      if (workspace.id === "manager") return canManager;
      if (workspace.id === "browser") return canBrowser;
      return false;
    });
  }
  const s3UserDetails = getS3UserDetails(user);
  const connectionDetails = getConnectionDetails(user);
  const hasAccountAdmin = links.some((link) => link.role === "account_administrator");
  const hasS3UserAccess = s3UserDetails.length > 0;
  const hasManagerConnectionAccess = connectionDetails.length > 0;
  const hasManagerAccess =
    contextAvailability?.manager ??
    (hasAccountAdmin || hasManagerConnectionAccess || hasS3UserAccess);
  const hasBrowserAccess =
    contextAvailability?.browser ??
    false;
  const resolvedPortalAccess = contextAvailability?.portal ?? hasPortalAccess;

  if (isAdminLikeRole(user.role)) {
    return ALL_WORKSPACES.filter((workspace) => {
      if (workspace.id === "ceph-admin") return canAccessCephAdmin(user);
      if (workspace.id === "storage-ops") return canAccessStorageOps(user) && hasManagerAccess;
      if (workspace.id === "manager") return hasManagerAccess;
      if (workspace.id === "portal") return resolvedPortalAccess;
      if (workspace.id === "browser") return hasBrowserAccess;
      return workspace.id === "admin";
    });
  }
  if (user.role !== USER_ROLE) return [];

  return ALL_WORKSPACES.filter((workspace) => {
    if (workspace.id === "storage-ops") return canAccessStorageOps(user) && hasManagerAccess;
    if (workspace.id === "manager") return hasManagerAccess;
    if (workspace.id === "portal") return resolvedPortalAccess;
    if (workspace.id === "browser") return hasBrowserAccess;
    return false;
  });
}

export function resolveAvailableWorkspacesWithFlags(
  user: SessionUser | null,
  generalSettings: GeneralSettings,
  contextAvailability?: WorkspaceContextAvailability
): WorkspaceOption[] {
  const filtered = resolveAvailableWorkspaces(user, contextAvailability).filter((workspace) => {
    if (workspace.id === "ceph-admin") return generalSettings.ceph_admin_enabled;
    if (workspace.id === "storage-ops") return generalSettings.storage_ops_enabled;
    if (workspace.id === "portal") return generalSettings.portal_enabled;
    if (workspace.id === "manager") return generalSettings.manager_enabled;
    if (workspace.id === "browser") return generalSettings.browser_enabled && generalSettings.browser_root_enabled;
    return true;
  });
  return filtered;
}

export function resolveWorkspaceFromPath(pathname: string, options: WorkspaceOption[]): WorkspaceOption | null {
  const segment = pathname.split("/")[1] || "";
  const active = options.find((option) => option.id === segment);
  return active ?? null;
}

function resolveRoleHomePath(user: SessionUser | null, generalSettings: GeneralSettings): string {
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
  const connectionDetails = getConnectionDetails(user);
  const hasAccountAdmin = links.some((link) => link.role === "account_administrator");
  const hasS3UserAccess = s3UserDetails.length > 0;
  const hasBrowserAccess = false;
  const hasManagerConnectionAccess = connectionDetails.length > 0;
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
      generalSettings.browser_root_enabled && hasBrowserAccess
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

export function resolvePostLoginPathWithWorkspaceAccess(
  user: SessionUser | null,
  generalSettings: GeneralSettings,
  access: WorkspaceAccess
): string {
  if (user?.authType === "s3_session") {
    return resolvePostLoginPath(user, generalSettings);
  }
  const available = resolveAvailableWorkspacesWithFlags(user, generalSettings, {
    manager: access.manager.available,
    browser: access.browser.available,
    portal: access.portal.available,
  }).filter((workspace) => {
    if (workspace.id === "admin") return access.admin.available;
    if (workspace.id === "ceph-admin") return access.ceph_admin.available;
    if (workspace.id === "storage-ops") return access.storage_ops.available;
    return true;
  });
  const preferredWorkspaceId = readStoredWorkspaceId();
  const preferred = preferredWorkspaceId
    ? available.find((workspace) => workspace.id === preferredWorkspaceId)
    : null;
  if (preferred) return preferred.path;
  const backendDefault = access.default_workspace
    ? available.find((workspace) => workspace.id === access.default_workspace)
    : null;
  return backendDefault?.path ?? "/unauthorized";
}

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
  authType?: "password" | "rgw_session" | "oidc" | null;
  account_links?: { account_id: number; account_role?: string | null; account_admin?: boolean | null }[] | null;
  capabilities?: {
    can_manage_buckets?: boolean;
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
  if (user.authType === "rgw_session") {
    return ALL_WORKSPACES.filter((workspace) => workspace.id === "manager" || workspace.id === "browser");
  }
  const links = user.account_links ?? [];
  const hasPortalAccess = links.some(
    (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
  );
  const hasAccountAdmin = links.some((link) => Boolean(link.account_admin));
  const hasManagerAccess = links.some(
    (link) => Boolean(link.account_admin) || link.account_role === "portal_manager"
  );
  const hasBucketAccess = links.some(
    (link) =>
      Boolean(link.account_admin) ||
      link.account_role === "portal_manager" ||
      link.account_role === "portal_user"
  );
  const portalOnly = hasPortalAccess && !hasAccountAdmin;
  const canManageBuckets = user.capabilities?.can_manage_buckets ?? hasBucketAccess;

  if (portalOnly) {
    return ALL_WORKSPACES.filter((workspace) => workspace.id === "portal");
  }

  return ALL_WORKSPACES.filter((workspace) => {
    if (workspace.id === "portal") return hasPortalAccess;
    if (workspace.id === "manager") return hasManagerAccess;
    if (workspace.id === "browser") return canManageBuckets;
    return false;
  });
}

export function resolveAvailableWorkspacesWithFlags(
  user: SessionUser | null,
  generalSettings: GeneralSettings
): WorkspaceOption[] {
  const filtered = resolveAvailableWorkspaces(user);
  return filtered.filter((workspace) => {
    if (workspace.id === "ceph-admin") return generalSettings.ceph_admin_enabled;
    if (workspace.id === "manager") return generalSettings.manager_enabled;
    if (workspace.id === "browser") return generalSettings.browser_enabled && generalSettings.browser_root_enabled;
    if (workspace.id === "portal") return generalSettings.portal_enabled;
    return true;
  });
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
  if (user.authType === "rgw_session") {
    if (generalSettings.manager_enabled) return "/manager";
    if (generalSettings.browser_enabled && generalSettings.browser_root_enabled && user.capabilities?.can_manage_buckets !== false) {
      return "/browser";
    }
    return "/unauthorized";
  }
  const links = user.account_links ?? [];
  const hasPortalAccess = links.some(
    (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
  );
  const hasAccountAdmin = links.some((link) => Boolean(link.account_admin));
  const hasManagerAccess = links.some(
    (link) => Boolean(link.account_admin) || link.account_role === "portal_manager"
  );
  const hasBucketAccess = links.some(
    (link) =>
      Boolean(link.account_admin) ||
      link.account_role === "portal_manager" ||
      link.account_role === "portal_user"
  );
  const portalOnly = hasPortalAccess && !hasAccountAdmin;
  const canManageBuckets = user.capabilities?.can_manage_buckets ?? hasBucketAccess;
  if (portalOnly && generalSettings.portal_enabled) return "/portal";
  if (generalSettings.manager_enabled && hasManagerAccess) return "/manager";
  if (hasPortalAccess && generalSettings.portal_enabled) return "/portal";
  if (generalSettings.browser_enabled && generalSettings.browser_root_enabled && canManageBuckets) return "/browser";
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

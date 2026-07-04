/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import type { GeneralSettings } from "./api/appSettings";
import { fetchCurrentUser } from "./api/users";
import { useGeneralSettings } from "./components/GeneralSettingsContext";
import { cx, uiCardClass } from "./components/ui/styles";
import { useS3AccountContext } from "./features/manager/S3AccountContext";
import FeatureDisabledPage from "./features/shared/FeatureDisabledPage";
import { CLIENT_STORAGE_KEYS, readClientStorage, writeClientJson } from "./utils/clientStorage";
import {
  getManagerToolAccess,
  hasPortalWorkspaceAccess,
  isAdminLikeRole,
  readStoredUser,
  resolvePostLoginPath,
  type SessionUser,
} from "./utils/workspaces";
import { prefetchWorkspaceBranch } from "./utils/routePrefetch";

const USER_ROLE = "ui_user";

function getStoredUser(): SessionUser | null {
  return readStoredUser();
}

function unauthorizedRoute() {
  return <Navigate to="/unauthorized" replace />;
}

function renderWorkspaceFeature(loading: boolean, enabled: boolean, feature: string) {
  if (loading) return <RouteFallback />;
  if (!enabled) return <FeatureDisabledPage feature={feature} />;
  return <Outlet />;
}

function renderManagerToolFeature(
  loading: boolean,
  enabled: boolean,
  feature: string,
  canAccess: boolean,
  requiresS3AccountSelection = true,
) {
  if (loading) return <RouteFallback />;
  if (!enabled) return <FeatureDisabledPage feature={feature} />;
  if (!requiresS3AccountSelection || !canAccess) return unauthorizedRoute();
  return <Outlet />;
}

export function RouteFallback() {
  return (
    <div className="shell-page flex min-h-screen items-center justify-center px-4">
      <div className={cx("px-4 py-3 ui-body font-semibold", uiCardClass)}>
        Loading workspace...
      </div>
    </div>
  );
}

export function RequireAuth() {
  const token = readClientStorage(CLIENT_STORAGE_KEYS.authToken);
  const user = getStoredUser();
  if (!token || !user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequireRole({ roles }: { roles: string[] }) {
  const user = getStoredUser();
  if (!user || !user.role) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return unauthorizedRoute();
  return <Outlet />;
}

export function RoleRedirect() {
  const user = getStoredUser();
  const { generalSettings, loading } = useGeneralSettings();
  const destination = loading ? null : resolvePostLoginPath(user, generalSettings);
  useEffect(() => {
    if (!destination) return;
    prefetchWorkspaceBranch(destination);
  }, [destination]);
  if (!destination) {
    return <RouteFallback />;
  }
  return <Navigate to={destination} replace />;
}

export function RequireManagerFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  return renderWorkspaceFeature(loading, generalSettings.manager_enabled, "Manager");
}

export function RequirePortalAccess() {
  const { generalSettings, loading } = useGeneralSettings();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(() => getStoredUser());
  const [refreshingSession, setRefreshingSession] = useState(() => {
    const storedUser = getStoredUser();
    return Boolean(
      typeof window !== "undefined" &&
        readClientStorage(CLIENT_STORAGE_KEYS.authToken) &&
        storedUser &&
        !hasPortalWorkspaceAccess(storedUser)
    );
  });

  useEffect(() => {
    if (loading || !generalSettings.portal_enabled || hasPortalWorkspaceAccess(sessionUser)) return;
    if (typeof window === "undefined" || !readClientStorage(CLIENT_STORAGE_KEYS.authToken)) return;
    let cancelled = false;
    setRefreshingSession(true);
    fetchCurrentUser()
      .then((currentUser) => {
        if (cancelled) return;
        const mergedUser = { ...(getStoredUser() ?? {}), ...currentUser } as SessionUser;
        writeClientJson(CLIENT_STORAGE_KEYS.sessionUser, mergedUser);
        setSessionUser(mergedUser);
      })
      .catch(() => {
        // The API client handles auth redirects; the guard falls back to unauthorized.
      })
      .finally(() => {
        if (!cancelled) setRefreshingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.portal_enabled, loading, sessionUser]);

  if (loading) {
    return <RouteFallback />;
  }
  if (!generalSettings.portal_enabled) {
    return <FeatureDisabledPage feature="Portal" />;
  }
  if (hasPortalWorkspaceAccess(sessionUser)) {
    return <Outlet />;
  }
  if (refreshingSession) {
    return <RouteFallback />;
  }
  if (!hasPortalWorkspaceAccess(sessionUser)) {
    return unauthorizedRoute();
  }
  return <Outlet />;
}

export function RequireCephAdminFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const user = getStoredUser();
  if (!user || !isAdminLikeRole(user.role) || !user.can_access_ceph_admin) {
    return unauthorizedRoute();
  }
  return renderWorkspaceFeature(loading, generalSettings.ceph_admin_enabled, "Ceph Admin");
}

export function RequireStorageOpsFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const user = getStoredUser();
  const canUseStorageOpsRole = Boolean(user && (isAdminLikeRole(user.role) || user.role === USER_ROLE));
  if (!user || !canUseStorageOpsRole || !user.can_access_storage_ops) {
    return unauthorizedRoute();
  }
  return renderWorkspaceFeature(loading, generalSettings.storage_ops_enabled, "Storage Ops");
}

export type BrowserSurface = "root" | "manager" | "ceph_admin";

export function isBrowserSurfaceEnabled(generalSettings: GeneralSettings, surface: BrowserSurface) {
  if (!generalSettings.browser_enabled) return false;
  if (surface === "root") return generalSettings.browser_root_enabled;
  if (surface === "manager") return generalSettings.browser_manager_enabled;
  return generalSettings.browser_ceph_admin_enabled;
}

export function RequireBrowserSurface({ surface }: { surface: BrowserSurface }) {
  const { generalSettings, loading } = useGeneralSettings();
  const user = getStoredUser();
  if (loading) return <RouteFallback />;
  const portalBrowserRootEnabled =
    surface === "root" &&
    generalSettings.browser_enabled &&
    generalSettings.portal_enabled &&
    generalSettings.browser_portal_enabled &&
    hasPortalWorkspaceAccess(user);
  if (!isBrowserSurfaceEnabled(generalSettings, surface) && !portalBrowserRootEnabled) {
    return <FeatureDisabledPage feature="Browser" />;
  }
  return <Outlet />;
}

export function RequireManagerIamFeature() {
  const { accounts, selectedS3AccountId, requiresS3AccountSelection, hasS3AccountContext } = useS3AccountContext();
  if (!requiresS3AccountSelection || !hasS3AccountContext) {
    return <Outlet />;
  }
  const selected = accounts.find((account) => account.id === selectedS3AccountId) ?? null;
  const iamEnabled = selected?.storage_endpoint_capabilities?.iam !== false;
  if (!iamEnabled) {
    return <FeatureDisabledPage feature="IAM" />;
  }
  return <Outlet />;
}

export function canAccessManagerMigration(generalSettings: GeneralSettings, user: SessionUser | null): boolean {
  if (!generalSettings.bucket_migration_enabled || !user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  return Boolean(getManagerToolAccess(user)?.bucket_migration);
}

export function canAccessManagerBucketCompare(generalSettings: GeneralSettings, user: SessionUser | null): boolean {
  if (!generalSettings.bucket_compare_enabled || !user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  if (!getManagerToolAccess(user)?.bucket_compare) return false;
  return user.capabilities?.can_manage_buckets !== false;
}

export function canAccessManagerBucketIntegrity(generalSettings: GeneralSettings, user: SessionUser | null): boolean {
  if (!generalSettings.bucket_integrity_check_enabled || !user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  if (!getManagerToolAccess(user)?.bucket_integrity_check) return false;
  return user.capabilities?.can_manage_buckets !== false;
}

export function canAccessManagerBucketPurge(generalSettings: GeneralSettings, user: SessionUser | null): boolean {
  if (!generalSettings.bucket_purge_enabled || !user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  if (!getManagerToolAccess(user)?.bucket_purge) return false;
  return user.capabilities?.can_manage_buckets !== false;
}

export function canAccessManagerFeatureRules(user: SessionUser | null): boolean {
  if (!user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  if (!getManagerToolAccess(user)?.feature_rules) return false;
  return user.capabilities?.can_manage_buckets !== false;
}

export function RequireManagerMigrationFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const user = getStoredUser();
  return renderManagerToolFeature(
    loading,
    generalSettings.bucket_migration_enabled,
    "Bucket Migration",
    canAccessManagerMigration(generalSettings, user),
  );
}

export function RequireManagerBucketCompareFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const { requiresS3AccountSelection } = useS3AccountContext();
  const user = getStoredUser();
  return renderManagerToolFeature(
    loading,
    generalSettings.bucket_compare_enabled,
    "Bucket Compare",
    canAccessManagerBucketCompare(generalSettings, user),
    requiresS3AccountSelection,
  );
}

export function RequireManagerBucketIntegrityFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const { requiresS3AccountSelection } = useS3AccountContext();
  const user = getStoredUser();
  return renderManagerToolFeature(
    loading,
    generalSettings.bucket_integrity_check_enabled,
    "Bucket Integrity",
    canAccessManagerBucketIntegrity(generalSettings, user),
    requiresS3AccountSelection,
  );
}

export function RequireManagerBucketPurgeFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const { requiresS3AccountSelection } = useS3AccountContext();
  const user = getStoredUser();
  return renderManagerToolFeature(
    loading,
    generalSettings.bucket_purge_enabled,
    "Bucket Purge",
    canAccessManagerBucketPurge(generalSettings, user),
    requiresS3AccountSelection,
  );
}

export function RequireManagerFeatureRulesTool() {
  const user = getStoredUser();
  if (canAccessManagerFeatureRules(user)) {
    return <Outlet />;
  }
  return unauthorizedRoute();
}

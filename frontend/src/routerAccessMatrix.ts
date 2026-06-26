/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type RouteAccessMatrixRow = {
  surface: "admin" | "manager" | "portal" | "browser" | "ceph-admin" | "storage-ops" | "shared";
  route: string;
  routeGuard: string;
  featureGate: string;
  uiGate: string;
  executionContext: string;
  storagePermissionAuthority: "S3/IAM/backend";
};

export const ROUTE_ACCESS_MATRIX: RouteAccessMatrixRow[] = [
  {
    surface: "shared",
    route: "/profile",
    routeGuard: "RequireAuth",
    featureGate: "none",
    uiGate: "authenticated UI session",
    executionContext: "none",
    storagePermissionAuthority: "S3/IAM/backend",
  },
  {
    surface: "admin",
    route: "/admin/*",
    routeGuard: "RequireRole(ui_superadmin, ui_admin)",
    featureGate: "per-page admin settings gates",
    uiGate: "admin-like UI role",
    executionContext: "platform governance",
    storagePermissionAuthority: "S3/IAM/backend",
  },
  {
    surface: "manager",
    route: "/manager/*",
    routeGuard: "RequireRole(ui_superadmin, ui_admin, ui_user), RequireManagerFeature",
    featureGate: "manager_enabled plus per-tool gates",
    uiGate: "selected account or connection context",
    executionContext: "manager execution context",
    storagePermissionAuthority: "S3/IAM/backend",
  },
  {
    surface: "manager",
    route: "/manager/users, /manager/groups, /manager/roles, /manager/iam/policies",
    routeGuard: "RequireManagerIamFeature",
    featureGate: "endpoint iam capability",
    uiGate: "IAM route visibility only",
    executionContext: "manager account context",
    storagePermissionAuthority: "S3/IAM/backend",
  },
  {
    surface: "manager",
    route: "/manager/migrations, /manager/bucket-compare, /manager/bucket-integrity, /manager/bucket-purge, /manager/feature-rules",
    routeGuard: "RequireManager*Tool guards",
    featureGate: "global tool flag and manager_tool_access",
    uiGate: "tool affordance only; not storage authorization",
    executionContext: "explicit manager context",
    storagePermissionAuthority: "S3/IAM/backend",
  },
  {
    surface: "browser",
    route: "/browser",
    routeGuard: "RequireBrowserSurface(root)",
    featureGate: "browser_enabled and browser_root_enabled",
    uiGate: "root Browser profile and advanced chrome flags",
    executionContext: "selected Browser execution context",
    storagePermissionAuthority: "S3/IAM/backend",
  },
  {
    surface: "portal",
    route: "/portal/*",
    routeGuard: "RequirePortalAccess",
    featureGate: "portal_enabled and browser_portal_enabled for embedded file profile",
    uiGate: "explicit portal_user or portal_manager account link",
    executionContext: "Portal account and Storage Space context",
    storagePermissionAuthority: "S3/IAM/backend",
  },
  {
    surface: "ceph-admin",
    route: "/ceph-admin/*",
    routeGuard: "RequireRole(ui_superadmin, ui_admin), RequireCephAdminFeature",
    featureGate: "ceph_admin_enabled and optional browser_ceph_admin_enabled",
    uiGate: "admin role plus can_access_ceph_admin",
    executionContext: "selected Ceph Admin endpoint",
    storagePermissionAuthority: "S3/IAM/backend",
  },
  {
    surface: "storage-ops",
    route: "/storage-ops/*",
    routeGuard: "RequireStorageOpsFeature",
    featureGate: "storage_ops_enabled",
    uiGate: "admin/user role plus can_access_storage_ops",
    executionContext: "selected operational account or endpoint scope",
    storagePermissionAuthority: "S3/IAM/backend",
  },
];

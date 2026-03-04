/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Suspense, lazy, useEffect, useMemo } from "react";
import { Navigate, Outlet, Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from "react-router-dom";
import Layout from "./components/Layout";
import { useS3AccountContext } from "./features/manager/S3AccountContext";
import { useGeneralSettings } from "./components/GeneralSettingsContext";
import {
  isAdminLikeRole,
  isSuperAdminRole,
  readStoredUser,
  resolvePostLoginPath,
  type SessionUser,
} from "./utils/workspaces";
import { prefetchWorkspaceBranch } from "./utils/routePrefetch";

const loadLoginPage = () => import("./features/auth/LoginPage");
const loadOidcCallbackPage = () => import("./features/auth/OidcCallbackPage");
const loadUnauthorizedPage = () => import("./features/auth/UnauthorizedPage");
const loadS3AccountsPage = () => import("./features/admin/AccountsPage");
const loadAuditLogsPage = () => import("./features/admin/AuditLogsPage");
const loadUsersPage = () => import("./features/admin/UsersPage");
const loadAdminDashboard = () => import("./features/admin/AdminDashboard");
const loadAdminMetricsPage = () => import("./features/admin/AdminMetricsPage");
const loadBillingPage = () => import("./features/admin/BillingPage");
const loadS3UsersPage = () => import("./features/admin/S3UsersPage");
const loadS3UserKeysPage = () => import("./features/admin/S3UserKeysPage");
const loadS3ConnectionsPage = () => import("./features/admin/S3ConnectionsPage");
const loadGeneralSettingsPage = () => import("./features/admin/GeneralSettingsPage");
const loadManagerSettingsPage = () => import("./features/admin/ManagerSettingsPage");
const loadAdminPortalSettingsPage = () => import("./features/admin/PortalSettingsPage");
const loadBrowserSettingsPage = () => import("./features/admin/BrowserSettingsPage");
const loadKeyRotationPage = () => import("./features/admin/KeyRotationPage");
const loadApiTokensPage = () => import("./features/admin/ApiTokensPage");
const loadFeatureDisabledPage = () => import("./features/shared/FeatureDisabledPage");
const loadBucketsPage = () => import("./features/manager/BucketsPage");
const loadManagerDashboard = () => import("./features/manager/ManagerDashboard");
const loadPoliciesPage = () => import("./features/manager/PoliciesPage");
const loadManagerLayout = () => import("./features/manager/ManagerLayout");
const loadStorageEndpointsPage = () => import("./features/admin/StorageEndpointsPage");
const loadEndpointStatusPage = () => import("./features/admin/EndpointStatusPage");
const loadEndpointStatusDetailPage = () => import("./features/admin/EndpointStatusDetailPage");
const loadManagerUsersPage = () => import("./features/manager/ManagerUsersPage");
const loadManagerUserKeysPage = () => import("./features/manager/ManagerUserKeysPage");
const loadBucketDetailPage = () => import("./features/manager/BucketDetailPage");
const loadBrowserPage = () => import("./features/browser/BrowserPage");
const loadManagerBrowserPage = () => import("./features/manager/ManagerBrowserPage");
const loadManagerGroupsPage = () => import("./features/manager/ManagerGroupsPage");
const loadManagerGroupUsersPage = () => import("./features/manager/ManagerGroupUsersPage");
const loadManagerRolesPage = () => import("./features/manager/ManagerRolesPage");
const loadManagerRolePoliciesPage = () => import("./features/manager/ManagerRolePoliciesPage");
const loadManagerUserPoliciesPage = () => import("./features/manager/ManagerUserPoliciesPage");
const loadManagerGroupPoliciesPage = () => import("./features/manager/ManagerGroupPoliciesPage");
const loadManagerMetricsPage = () => import("./features/manager/ManagerMetricsPage");
const loadTopicsPage = () => import("./features/manager/TopicsPage");
const loadManagerMigrationsPage = () => import("./features/manager/ManagerMigrationsPage");
const loadManagerBucketComparePage = () => import("./features/manager/ManagerBucketComparePage");
const loadPortalLayout = () => import("./features/portal/PortalLayout");
const loadPortalDashboard = () => import("./features/portal/PortalDashboard");
const loadPortalBucketsPage = () => import("./features/portal/PortalBucketsPage");
const loadPortalBrowserPage = () => import("./features/portal/PortalBrowserPage");
const loadPortalManagePage = () => import("./features/portal/PortalManagePage");
const loadPortalSettingsPage = () => import("./features/portal/PortalSettingsPage");
const loadPortalBillingPage = () => import("./features/portal/BillingPage");
const loadBrowserLayout = () => import("./features/browser/BrowserLayout");
const loadCephAdminLayout = () => import("./features/cephAdmin/CephAdminLayout");
const loadCephAdminDashboard = () => import("./features/cephAdmin/CephAdminDashboard");
const loadCephAdminAccountsPage = () => import("./features/cephAdmin/CephAdminAccountsPage");
const loadCephAdminUsersPage = () => import("./features/cephAdmin/CephAdminUsersPage");
const loadCephAdminBucketsPage = () => import("./features/cephAdmin/CephAdminBucketsPage");
const loadCephAdminBucketDetailPage = () => import("./features/cephAdmin/CephAdminBucketDetailPage");
const loadCephAdminMetricsPage = () => import("./features/cephAdmin/CephAdminMetricsPage");
const loadCephAdminBrowserPage = () => import("./features/cephAdmin/CephAdminBrowserPage");
const loadProfilePage = () => import("./features/shared/ProfilePage");

const LoginPage = lazy(loadLoginPage);
const OidcCallbackPage = lazy(loadOidcCallbackPage);
const UnauthorizedPage = lazy(loadUnauthorizedPage);
const S3AccountsPage = lazy(loadS3AccountsPage);
const AuditLogsPage = lazy(loadAuditLogsPage);
const UsersPage = lazy(loadUsersPage);
const AdminDashboard = lazy(loadAdminDashboard);
const AdminMetricsPage = lazy(loadAdminMetricsPage);
const BillingPage = lazy(loadBillingPage);
const S3UsersPage = lazy(loadS3UsersPage);
const S3UserKeysPage = lazy(loadS3UserKeysPage);
const S3ConnectionsPage = lazy(loadS3ConnectionsPage);
const GeneralSettingsPage = lazy(loadGeneralSettingsPage);
const ManagerSettingsPage = lazy(loadManagerSettingsPage);
const AdminPortalSettingsPage = lazy(loadAdminPortalSettingsPage);
const BrowserSettingsPage = lazy(loadBrowserSettingsPage);
const KeyRotationPage = lazy(loadKeyRotationPage);
const ApiTokensPage = lazy(loadApiTokensPage);
const FeatureDisabledPage = lazy(loadFeatureDisabledPage);
const BucketsPage = lazy(loadBucketsPage);
const ManagerDashboard = lazy(loadManagerDashboard);
const PoliciesPage = lazy(loadPoliciesPage);
const ManagerLayout = lazy(loadManagerLayout);
const StorageEndpointsPage = lazy(loadStorageEndpointsPage);
const EndpointStatusPage = lazy(loadEndpointStatusPage);
const EndpointStatusDetailPage = lazy(loadEndpointStatusDetailPage);
const ManagerUsersPage = lazy(loadManagerUsersPage);
const ManagerUserKeysPage = lazy(loadManagerUserKeysPage);
const BucketDetailPage = lazy(loadBucketDetailPage);
const BrowserPage = lazy(loadBrowserPage);
const ManagerBrowserPage = lazy(loadManagerBrowserPage);
const ManagerGroupsPage = lazy(loadManagerGroupsPage);
const ManagerGroupUsersPage = lazy(loadManagerGroupUsersPage);
const ManagerRolesPage = lazy(loadManagerRolesPage);
const ManagerRolePoliciesPage = lazy(loadManagerRolePoliciesPage);
const ManagerUserPoliciesPage = lazy(loadManagerUserPoliciesPage);
const ManagerGroupPoliciesPage = lazy(loadManagerGroupPoliciesPage);
const ManagerMetricsPage = lazy(loadManagerMetricsPage);
const TopicsPage = lazy(loadTopicsPage);
const ManagerMigrationsPage = lazy(loadManagerMigrationsPage);
const ManagerBucketComparePage = lazy(loadManagerBucketComparePage);
const PortalLayout = lazy(loadPortalLayout);
const PortalDashboard = lazy(loadPortalDashboard);
const PortalBucketsPage = lazy(loadPortalBucketsPage);
const PortalBrowserPage = lazy(loadPortalBrowserPage);
const PortalManagePage = lazy(loadPortalManagePage);
const PortalSettingsPage = lazy(loadPortalSettingsPage);
const PortalBillingPage = lazy(loadPortalBillingPage);
const BrowserLayout = lazy(loadBrowserLayout);
const CephAdminLayout = lazy(loadCephAdminLayout);
const CephAdminDashboard = lazy(loadCephAdminDashboard);
const CephAdminAccountsPage = lazy(loadCephAdminAccountsPage);
const CephAdminUsersPage = lazy(loadCephAdminUsersPage);
const CephAdminBucketsPage = lazy(loadCephAdminBucketsPage);
const CephAdminBucketDetailPage = lazy(loadCephAdminBucketDetailPage);
const CephAdminMetricsPage = lazy(loadCephAdminMetricsPage);
const CephAdminBrowserPage = lazy(loadCephAdminBrowserPage);
const ProfilePage = lazy(loadProfilePage);

const SUPERADMIN_ROLE = "ui_superadmin";
const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 ui-body font-semibold text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        Loading workspace...
      </div>
    </div>
  );
}

const buildAdminNav = (
  portalEnabled: boolean,
  browserEnabled: boolean,
  billingEnabled: boolean,
  endpointStatusEnabled: boolean,
  isSuperAdmin: boolean
) => {
  const settingsLinks = [
    { to: "/admin/general-settings", label: "General" },
    { to: "/admin/manager-settings", label: "Manager" },
    { to: "/admin/browser-settings", label: "Browser", disabled: !browserEnabled },
    { to: "/admin/portal-settings", label: "Portal", disabled: !portalEnabled },
    { to: "/admin/key-rotation", label: "Key Rotation" },
    { to: "/admin/api-tokens", label: "API Tokens" },
  ];

  return [
    {
      label: "Overview",
      links: [
        { to: "/admin", label: "Dashboard", end: true },
        { to: "/admin/metrics", label: "Metrics" },
        ...(billingEnabled ? [{ to: "/admin/billing", label: "Billing" }] : []),
      ],
    },
    {
      label: "Platform",
      links: [{ to: "/admin/users", label: "UI Users" }],
    },
    {
      label: "Managed Tenants",
      links: [
        { to: "/admin/s3-accounts", label: "RGW Accounts" },
        { to: "/admin/s3-users", label: "RGW Users" },
      ],
    },
    {
      label: "Connections",
      links: [{ to: "/admin/s3-connections", label: "S3 Connections" }],
    },
    {
      label: "Storage Backends",
      links: [
        { to: "/admin/storage-endpoints", label: "S3 Endpoints" },
        ...(endpointStatusEnabled ? [{ to: "/admin/endpoint-status", label: "Endpoint Status" }] : []),
      ],
    },
    {
      label: "Governance",
      links: [{ to: "/admin/audit", label: "Audit trail" }],
    },
    ...(isSuperAdmin
      ? [
          {
            label: "Settings",
            links: settingsLinks,
            collapsed: true,
          },
        ]
      : []),
  ];
};

function getStoredUser(): SessionUser | null {
  return readStoredUser();
}

function RequireAuth() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const user = getStoredUser();
  if (!token || !user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AdminLayoutShell() {
  const { generalSettings } = useGeneralSettings();
  const currentUser = getStoredUser();
  const canConfigureApp = isSuperAdminRole(currentUser?.role);
  const adminNav = buildAdminNav(
    generalSettings.portal_enabled,
    generalSettings.browser_enabled,
    generalSettings.billing_enabled,
    generalSettings.endpoint_status_enabled,
    canConfigureApp
  );
  return (
    <Layout
      navSections={adminNav}
      headerTitle="Administration"
      sidebarTitle="ADMIN"
      hideHeader
    />
  );
}

function AdminPortalSettingsRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.portal_enabled ? <AdminPortalSettingsPage /> : <FeatureDisabledPage feature="Portal" />;
}

function AdminBillingRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.billing_enabled ? <BillingPage /> : <FeatureDisabledPage feature="Billing" />;
}

function PortalBillingRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.billing_enabled ? <PortalBillingPage /> : <FeatureDisabledPage feature="Billing" />;
}

function AdminEndpointStatusRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.endpoint_status_enabled
    ? <EndpointStatusPage />
    : <FeatureDisabledPage feature="Endpoint Status" />;
}

function AdminEndpointStatusDetailRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.endpoint_status_enabled
    ? <EndpointStatusDetailPage />
    : <FeatureDisabledPage feature="Endpoint Status" />;
}

function RequireRole({ roles }: { roles: string[] }) {
  const user = getStoredUser();
  if (!user || !user.role) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}

function RoleRedirect() {
  const user = getStoredUser();
  const { generalSettings } = useGeneralSettings();
  const destination = resolvePostLoginPath(user, generalSettings);
  useEffect(() => {
    prefetchWorkspaceBranch(destination);
  }, [destination]);
  return <Navigate to={destination} replace />;
}

function RequireFeature({ feature }: { feature: "manager" | "browser" | "portal" }) {
  const { generalSettings } = useGeneralSettings();
  const enabled =
    feature === "manager"
      ? generalSettings.manager_enabled
      : feature === "browser"
        ? generalSettings.browser_enabled
        : generalSettings.portal_enabled;
  if (!enabled) {
    const label = feature === "manager" ? "Manager" : feature === "browser" ? "Browser" : "Portal";
    return <FeatureDisabledPage feature={label} />;
  }
  return <Outlet />;
}

function RequireCephAdminFeature() {
  const { generalSettings } = useGeneralSettings();
  const user = getStoredUser();
  if (!user || !isAdminLikeRole(user.role) || !user.can_access_ceph_admin) {
    return <Navigate to="/unauthorized" replace />;
  }
  if (!generalSettings.ceph_admin_enabled) {
    return <FeatureDisabledPage feature="Ceph Admin" />;
  }
  return <Outlet />;
}

function isBrowserSurfaceEnabled(
  generalSettings: ReturnType<typeof useGeneralSettings>["generalSettings"],
  surface: "root" | "manager" | "portal" | "ceph_admin"
) {
  if (!generalSettings.browser_enabled) return false;
  if (surface === "root") return generalSettings.browser_root_enabled;
  if (surface === "manager") return generalSettings.browser_manager_enabled;
  if (surface === "portal") return generalSettings.browser_portal_enabled;
  return generalSettings.browser_ceph_admin_enabled;
}

function RequireBrowserSurface({ surface }: { surface: "root" | "manager" | "portal" | "ceph_admin" }) {
  const { generalSettings } = useGeneralSettings();
  if (!isBrowserSurfaceEnabled(generalSettings, surface)) {
    return <FeatureDisabledPage feature="Browser" />;
  }
  return <Outlet />;
}

function RequireManagerIamFeature() {
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

function canAccessManagerMigration(
  generalSettings: ReturnType<typeof useGeneralSettings>["generalSettings"],
  user: SessionUser | null
): boolean {
  if (!generalSettings.bucket_migration_enabled || !user?.role) return false;
  if (isAdminLikeRole(user.role)) return true;
  return user.role === USER_ROLE && generalSettings.allow_ui_user_bucket_migration;
}

function canAccessManagerBucketCompare(
  generalSettings: ReturnType<typeof useGeneralSettings>["generalSettings"],
  user: SessionUser | null
): boolean {
  if (!generalSettings.bucket_compare_enabled || !user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  return user.capabilities?.can_manage_buckets !== false;
}

function RequireManagerMigrationFeature() {
  const { generalSettings } = useGeneralSettings();
  const user = getStoredUser();
  if (!generalSettings.bucket_migration_enabled) {
    return <FeatureDisabledPage feature="Bucket Migration" />;
  }
  if (canAccessManagerMigration(generalSettings, user)) {
    return <Outlet />;
  }
  return <Navigate to="/unauthorized" replace />;
}

function RequireManagerBucketCompareFeature() {
  const { generalSettings } = useGeneralSettings();
  const { requiresS3AccountSelection } = useS3AccountContext();
  const user = getStoredUser();
  if (!generalSettings.bucket_compare_enabled) {
    return <FeatureDisabledPage feature="Bucket Compare" />;
  }
  if (!requiresS3AccountSelection) {
    return <Navigate to="/unauthorized" replace />;
  }
  if (canAccessManagerBucketCompare(generalSettings, user)) {
    return <Outlet />;
  }
  return <Navigate to="/unauthorized" replace />;
}

export default function AppRouter() {
  const router = useMemo(() => {
    const routes = createRoutesFromElements(
      <>
        <Route element={<RequireAuth />}>
          <Route index element={<RoleRedirect />} />
          <Route path="/profile" element={<Layout headerTitle="Profile" headerSubtitle="Account" hideSidebar />}>
            <Route index element={<ProfilePage />} />
          </Route>

          <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE]} />}>
            <Route path="/admin" element={<AdminLayoutShell />}>
              <Route index element={<AdminDashboard />} />
              <Route path="s3-accounts" element={<S3AccountsPage />} />
              <Route path="accounts" element={<Navigate to="/admin/s3-accounts" replace />} />
              <Route path="s3-users" element={<S3UsersPage />} />
              <Route path="s3-connections" element={<S3ConnectionsPage />} />
              <Route path="s3-users/:userId/keys" element={<S3UserKeysPage />} />
              <Route path="storage-endpoints" element={<StorageEndpointsPage />} />
              <Route path="endpoint-status" element={<AdminEndpointStatusRoute />} />
              <Route path="endpoint-status/:endpointId" element={<AdminEndpointStatusDetailRoute />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="audit" element={<AuditLogsPage />} />
              <Route path="metrics" element={<AdminMetricsPage />} />
              <Route path="billing" element={<AdminBillingRoute />} />
              <Route path="api-tokens" element={<ApiTokensPage />} />
              <Route element={<RequireRole roles={[SUPERADMIN_ROLE]} />}>
                <Route path="general-settings" element={<GeneralSettingsPage />} />
                <Route path="manager-settings" element={<ManagerSettingsPage />} />
                <Route path="portal-settings" element={<AdminPortalSettingsRoute />} />
                <Route path="browser-settings" element={<BrowserSettingsPage />} />
                <Route path="key-rotation" element={<KeyRotationPage />} />
              </Route>
            </Route>
          </Route>

          <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE]} />}>
            <Route element={<RequireCephAdminFeature />}>
              <Route path="/ceph-admin" element={<CephAdminLayout />}>
                <Route index element={<CephAdminDashboard />} />
                <Route path="metrics" element={<CephAdminMetricsPage />} />
                <Route path="accounts" element={<CephAdminAccountsPage />} />
                <Route path="users" element={<CephAdminUsersPage />} />
                <Route path="buckets" element={<CephAdminBucketsPage />} />
                <Route path="buckets/:bucketName" element={<CephAdminBucketDetailPage />} />
                <Route element={<RequireBrowserSurface surface="ceph_admin" />}>
                  <Route path="browser" element={<CephAdminBrowserPage />} />
                </Route>
              </Route>
            </Route>
          </Route>

          <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE, USER_ROLE]} />}>
            <Route element={<RequireFeature feature="manager" />}>
              <Route path="/manager" element={<ManagerLayout />}>
                <Route index element={<ManagerDashboard />} />
                <Route path="buckets" element={<BucketsPage />} />
                <Route path="buckets/:bucketName" element={<BucketDetailPage />} />
                <Route element={<RequireBrowserSurface surface="manager" />}>
                  <Route path="browser" element={<ManagerBrowserPage />} />
                </Route>
                <Route path="metrics" element={<ManagerMetricsPage />} />
                <Route element={<RequireManagerIamFeature />}>
                  <Route path="users" element={<ManagerUsersPage />} />
                  <Route path="users/:userName/keys" element={<ManagerUserKeysPage />} />
                  <Route path="users/:userName/policies" element={<ManagerUserPoliciesPage />} />
                  <Route path="groups" element={<ManagerGroupsPage />} />
                  <Route path="groups/:groupName/policies" element={<ManagerGroupPoliciesPage />} />
                  <Route path="groups/:groupName/users" element={<ManagerGroupUsersPage />} />
                  <Route path="roles" element={<ManagerRolesPage />} />
                  <Route path="roles/:roleName/policies" element={<ManagerRolePoliciesPage />} />
                  <Route path="iam/policies" element={<PoliciesPage />} />
                </Route>
                <Route path="topics" element={<TopicsPage />} />
                <Route element={<RequireManagerBucketCompareFeature />}>
                  <Route path="bucket-compare" element={<ManagerBucketComparePage />} />
                </Route>
                <Route element={<RequireManagerMigrationFeature />}>
                  <Route path="migrations" element={<ManagerMigrationsPage />} />
                </Route>
              </Route>
            </Route>

            <Route element={<RequireBrowserSurface surface="root" />}>
              <Route path="/browser" element={<BrowserLayout />}>
                <Route index element={<BrowserPage />} />
              </Route>
            </Route>
          </Route>

          <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE, USER_ROLE]} />}>
            <Route element={<RequireFeature feature="portal" />}>
              <Route path="/portal" element={<PortalLayout />}>
                <Route index element={<PortalDashboard />} />
                <Route path="buckets" element={<PortalBucketsPage />} />
                <Route element={<RequireBrowserSurface surface="portal" />}>
                  <Route path="browser" element={<PortalBrowserPage />} />
                </Route>
                <Route path="manage" element={<PortalManagePage />} />
                <Route path="billing" element={<PortalBillingRoute />} />
                <Route path="settings" element={<PortalSettingsPage />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="/login" element={<LoginPage />} />
        <Route path="/oidc/:provider/callback" element={<OidcCallbackPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </>
    );
    return createBrowserRouter(routes, {
      future: { v7_relativeSplatPath: true },
    });
  }, []);
  return (
    <Suspense fallback={<RouteFallback />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}

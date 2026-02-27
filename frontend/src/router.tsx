/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { Navigate, Outlet, Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from "react-router-dom";
import Layout from "./components/Layout";
import LoginPage from "./features/auth/LoginPage";
import OidcCallbackPage from "./features/auth/OidcCallbackPage";
import UnauthorizedPage from "./features/auth/UnauthorizedPage";
import S3AccountsPage from "./features/admin/AccountsPage";
import AuditLogsPage from "./features/admin/AuditLogsPage";
import UsersPage from "./features/admin/UsersPage";
import AdminDashboard from "./features/admin/AdminDashboard";
import AdminMetricsPage from "./features/admin/AdminMetricsPage";
import BillingPage from "./features/admin/BillingPage";
import S3UsersPage from "./features/admin/S3UsersPage";
import S3UserKeysPage from "./features/admin/S3UserKeysPage";
import S3ConnectionsPage from "./features/admin/S3ConnectionsPage";
import GeneralSettingsPage from "./features/admin/GeneralSettingsPage";
import ManagerSettingsPage from "./features/admin/ManagerSettingsPage";
import AdminPortalSettingsPage from "./features/admin/PortalSettingsPage";
import BrowserSettingsPage from "./features/admin/BrowserSettingsPage";
import KeyRotationPage from "./features/admin/KeyRotationPage";
import ApiTokensPage from "./features/admin/ApiTokensPage";
import FeatureDisabledPage from "./features/shared/FeatureDisabledPage";
import BucketsPage from "./features/manager/BucketsPage";
import ManagerDashboard from "./features/manager/ManagerDashboard";
import PoliciesPage from "./features/manager/PoliciesPage";
import ManagerLayout from "./features/manager/ManagerLayout";
import StorageEndpointsPage from "./features/admin/StorageEndpointsPage";
import EndpointStatusPage from "./features/admin/EndpointStatusPage";
import EndpointStatusDetailPage from "./features/admin/EndpointStatusDetailPage";
import ManagerUsersPage from "./features/manager/ManagerUsersPage";
import ManagerUserKeysPage from "./features/manager/ManagerUserKeysPage";
import BucketDetailPage from "./features/manager/BucketDetailPage";
import BrowserPage from "./features/browser/BrowserPage";
import ManagerBrowserPage from "./features/manager/ManagerBrowserPage";
import ManagerGroupsPage from "./features/manager/ManagerGroupsPage";
import ManagerGroupUsersPage from "./features/manager/ManagerGroupUsersPage";
import ManagerRolesPage from "./features/manager/ManagerRolesPage";
import ManagerRolePoliciesPage from "./features/manager/ManagerRolePoliciesPage";
import ManagerUserPoliciesPage from "./features/manager/ManagerUserPoliciesPage";
import ManagerGroupPoliciesPage from "./features/manager/ManagerGroupPoliciesPage";
import ManagerMetricsPage from "./features/manager/ManagerMetricsPage";
import TopicsPage from "./features/manager/TopicsPage";
import ManagerMigrationsPage from "./features/manager/ManagerMigrationsPage";
import { useS3AccountContext } from "./features/manager/S3AccountContext";
import PortalLayout from "./features/portal/PortalLayout";
import PortalDashboard from "./features/portal/PortalDashboard";
import PortalBucketsPage from "./features/portal/PortalBucketsPage";
import PortalBrowserPage from "./features/portal/PortalBrowserPage";
import PortalManagePage from "./features/portal/PortalManagePage";
import PortalSettingsPage from "./features/portal/PortalSettingsPage";
import PortalBillingPage from "./features/portal/BillingPage";
import BrowserLayout from "./features/browser/BrowserLayout";
import { useGeneralSettings } from "./components/GeneralSettingsContext";
import CephAdminLayout from "./features/cephAdmin/CephAdminLayout";
import CephAdminDashboard from "./features/cephAdmin/CephAdminDashboard";
import CephAdminAccountsPage from "./features/cephAdmin/CephAdminAccountsPage";
import CephAdminUsersPage from "./features/cephAdmin/CephAdminUsersPage";
import CephAdminBucketsPage from "./features/cephAdmin/CephAdminBucketsPage";
import CephAdminBucketDetailPage from "./features/cephAdmin/CephAdminBucketDetailPage";
import CephAdminMetricsPage from "./features/cephAdmin/CephAdminMetricsPage";
import CephAdminBrowserPage from "./features/cephAdmin/CephAdminBrowserPage";
import ProfilePage from "./features/shared/ProfilePage";
import {
  isAdminLikeRole,
  isSuperAdminRole,
  readStoredUser,
  resolvePostLoginPath,
  type SessionUser,
} from "./utils/workspaces";

const SUPERADMIN_ROLE = "ui_superadmin";
const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";

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
      sidebarTitle="ADMIN"
      hideHeader
      topbarContent={<span className="ui-body text-slate-500 dark:text-slate-300">Administration globale</span>}
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
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    });
  }, []);
  return <RouterProvider router={router} />;
}

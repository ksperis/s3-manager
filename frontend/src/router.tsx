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

const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";
const UNASSIGNED_ROLE = "ui_none";

type StoredUser = {
  role?: string | null;
  can_access_ceph_admin?: boolean | null;
  email?: string | null;
  accounts?: number[] | null;
  account_links?: { account_id: number; account_role?: string | null; account_admin?: boolean | null }[] | null;
  authType?: "password" | "rgw_session" | "oidc";
  authProvider?: string | null;
  actorType?: string | null;
  accountId?: string | null;
  capabilities?: {
    can_manage_iam?: boolean;
    can_manage_buckets?: boolean;
    can_view_traffic?: boolean;
  };
};

const buildAdminNav = (
  portalEnabled: boolean,
  browserEnabled: boolean,
  billingEnabled: boolean,
  endpointStatusEnabled: boolean
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
    {
      label: "Settings",
      links: settingsLinks,
      collapsed: true,
    },
  ];
};

function getStoredUser(): StoredUser | null {
  const raw = typeof window !== "undefined" ? localStorage.getItem("user") : null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

function RequireAuth() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const user = getStoredUser();
  if (!token || !user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AdminLayoutShell() {
  const { generalSettings } = useGeneralSettings();
  const adminNav = buildAdminNav(
    generalSettings.portal_enabled,
    generalSettings.browser_enabled,
    generalSettings.billing_enabled,
    generalSettings.endpoint_status_enabled
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

function RequireRole({ roles }: { roles: string[] }) {
  const user = getStoredUser();
  if (!user || !user.role) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}

function RoleRedirect() {
  const user = getStoredUser();
  const { generalSettings } = useGeneralSettings();
  if (!user || !user.role) return <Navigate to="/login" replace />;
  if (user.role === ADMIN_ROLE) return <Navigate to="/admin" replace />;
  if (user.role === USER_ROLE) {
    const links = user.account_links ?? [];
    const hasPortalAccess = links.some(
      (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
    );
    const hasAccountAdmin = links.some((link) => link.account_admin);
    const portalOnly = hasPortalAccess && !hasAccountAdmin;
    const canManageBuckets = user.capabilities?.can_manage_buckets !== false;
    if (portalOnly && generalSettings.portal_enabled) return <Navigate to="/portal" replace />;
    if (generalSettings.manager_enabled) return <Navigate to="/manager" replace />;
    if (hasPortalAccess && generalSettings.portal_enabled) return <Navigate to="/portal" replace />;
    if (isBrowserSurfaceEnabled(generalSettings, "root") && canManageBuckets) {
      return <Navigate to="/browser" replace />;
    }
    return <Navigate to="/unauthorized" replace />;
  }
  if (user.role === UNASSIGNED_ROLE) return <Navigate to="/unauthorized" replace />;
  return <Navigate to="/unauthorized" replace />;
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
  if (!user || user.role !== ADMIN_ROLE || !user.can_access_ceph_admin) {
    return <Navigate to="/unauthorized" replace />;
  }
  if (!generalSettings.ceph_admin_enabled) {
    return <FeatureDisabledPage feature="Ceph Admin" />;
  }
  return <Outlet />;
}

function isBrowserSurfaceEnabled(
  generalSettings: ReturnType<typeof useGeneralSettings>["generalSettings"],
  surface: "root" | "manager" | "portal"
) {
  if (!generalSettings.browser_enabled) return false;
  if (surface === "root") return generalSettings.browser_root_enabled;
  if (surface === "manager") return generalSettings.browser_manager_enabled;
  return generalSettings.browser_portal_enabled;
}

function RequireBrowserSurface({ surface }: { surface: "root" | "manager" | "portal" }) {
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

export default function AppRouter() {
  const router = useMemo(() => {
    const routes = createRoutesFromElements(
      <>
        <Route element={<RequireAuth />}>
          <Route index element={<RoleRedirect />} />

          <Route element={<RequireRole roles={[ADMIN_ROLE]} />}>
            <Route path="/admin" element={<AdminLayoutShell />}>
              <Route index element={<AdminDashboard />} />
              <Route path="s3-accounts" element={<S3AccountsPage />} />
              <Route path="accounts" element={<Navigate to="/admin/s3-accounts" replace />} />
              <Route path="s3-users" element={<S3UsersPage />} />
              <Route path="s3-connections" element={<S3ConnectionsPage />} />
              <Route path="s3-users/:userId/keys" element={<S3UserKeysPage />} />
              <Route path="storage-endpoints" element={<StorageEndpointsPage />} />
              <Route path="endpoint-status" element={<AdminEndpointStatusRoute />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="audit" element={<AuditLogsPage />} />
              <Route path="metrics" element={<AdminMetricsPage />} />
              <Route path="billing" element={<AdminBillingRoute />} />
              <Route path="general-settings" element={<GeneralSettingsPage />} />
              <Route path="manager-settings" element={<ManagerSettingsPage />} />
              <Route path="api-tokens" element={<ApiTokensPage />} />
              <Route path="portal-settings" element={<AdminPortalSettingsRoute />} />
              <Route path="browser-settings" element={<BrowserSettingsPage />} />
              <Route path="key-rotation" element={<KeyRotationPage />} />
            </Route>
          </Route>

          <Route element={<RequireRole roles={[ADMIN_ROLE]} />}>
            <Route element={<RequireCephAdminFeature />}>
              <Route path="/ceph-admin" element={<CephAdminLayout />}>
                <Route index element={<CephAdminDashboard />} />
                <Route path="metrics" element={<CephAdminMetricsPage />} />
                <Route path="accounts" element={<CephAdminAccountsPage />} />
                <Route path="users" element={<CephAdminUsersPage />} />
                <Route path="buckets" element={<CephAdminBucketsPage />} />
                <Route path="buckets/:bucketName" element={<CephAdminBucketDetailPage />} />
              </Route>
            </Route>
          </Route>

          <Route element={<RequireRole roles={[ADMIN_ROLE, USER_ROLE]} />}>
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
              </Route>
            </Route>

            <Route element={<RequireBrowserSurface surface="root" />}>
              <Route path="/browser" element={<BrowserLayout />}>
                <Route index element={<BrowserPage />} />
              </Route>
            </Route>
          </Route>

          <Route element={<RequireRole roles={[ADMIN_ROLE, USER_ROLE]} />}>
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

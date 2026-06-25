/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Suspense, lazy, useMemo } from "react";
import { Navigate, Outlet, Route, RouterProvider, createBrowserRouter, createRoutesFromElements, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { useGeneralSettings } from "./components/GeneralSettingsContext";
import RouteErrorPage from "./features/shared/RouteErrorPage";
import {
  RequireAuth,
  RequireBrowserSurface,
  RequireCephAdminFeature,
  RequireManagerBucketCompareFeature,
  RequireManagerBucketIntegrityFeature,
  RequireManagerBucketPurgeFeature,
  RequireManagerFeature,
  RequireManagerFeatureRulesTool,
  RequireManagerIamFeature,
  RequireManagerMigrationFeature,
  RequirePortalAccess,
  RequireRole,
  RouteFallback,
  RequireStorageOpsFeature,
  RoleRedirect,
} from "./routerGuards";
import {
  isSuperAdminRole,
  readStoredUser,
} from "./utils/workspaces";

export { RequireManagerFeatureRulesTool, RequirePortalAccess } from "./routerGuards";

const loadLoginPage = () => import("./features/auth/LoginPage");
const loadOidcCallbackPage = () => import("./features/auth/OidcCallbackPage");
const loadUnauthorizedPage = () => import("./features/auth/UnauthorizedPage");
const loadS3AccountsPage = () => import("./features/admin/AccountsPage");
const loadAuditLogsPage = () => import("./features/admin/AuditLogsPage");
const loadUsersPage = () => import("./features/admin/UsersPage");
const loadGroupsPage = () => import("./features/admin/GroupsPage");
const loadAdminDashboard = () => import("./features/admin/AdminDashboard");
const loadAdminMetricsPage = () => import("./features/admin/AdminMetricsPage");
const loadBillingPage = () => import("./features/admin/BillingPage");
const loadUsageHistoryPage = () => import("./features/admin/UsageHistoryPage");
const loadS3UsersPage = () => import("./features/admin/S3UsersPage");
const loadS3UserKeysPage = () => import("./features/admin/S3UserKeysPage");
const loadS3ConnectionsPage = () => import("./features/admin/S3ConnectionsPage");
const loadGeneralSettingsPage = () => import("./features/admin/GeneralSettingsPage");
const loadManagerSettingsPage = () => import("./features/admin/ManagerSettingsPage");
const loadAdminPortalSettingsPage = () => import("./features/admin/PortalSettingsPage");
const loadBrowserSettingsPage = () => import("./features/admin/BrowserSettingsPage");
const loadKeyRotationPage = () => import("./features/admin/KeyRotationPage");
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
const loadManagerMigrationDetailPage = () => import("./features/manager/ManagerMigrationDetailPage");
const loadManagerMigrationWizardPage = () => import("./features/manager/ManagerMigrationWizardPage");
const loadManagerBucketComparePage = () => import("./features/manager/ManagerBucketComparePage");
const loadManagerBucketIntegrityPage = () => import("./features/manager/ManagerBucketIntegrityPage");
const loadManagerBucketPurgePage = () => import("./features/manager/ManagerBucketPurgePage");
const loadManagerFeatureRulesPage = () => import("./features/manager/ManagerFeatureRulesPage");
const loadManagerCephKeysPage = () => import("./features/manager/ManagerCephKeysPage");
const loadPortalLayout = () => import("./features/portal/PortalLayout");
const loadPortalDashboard = () => import("./features/portal/PortalDashboard");
const loadPortalAccessKeysPage = () => import("./features/portal/PortalAccessKeysPage");
const loadPortalStorageSpacesPage = () => import("./features/portal/PortalStorageSpacesPage");
const loadPortalStorageSpaceDetailPage = () => import("./features/portal/PortalStorageSpaceDetailPage");
const loadPortalObjectDetailPage = () => import("./features/portal/PortalObjectDetailPage");
const loadPortalSharesPage = () => import("./features/portal/PortalSharesPage");
const loadPortalActivityPage = () => import("./features/portal/PortalActivityPage");
const loadPortalTransfersPage = () => import("./features/portal/PortalTransfersPage");
const loadPortalUsagePage = () => import("./features/portal/PortalUsagePage");
const loadPortalSettingsPage = () => import("./features/portal/PortalSettingsPage");
const loadBrowserLayout = () => import("./features/browser/BrowserLayout");
const loadCephAdminLayout = () => import("./features/cephAdmin/CephAdminLayout");
const loadCephAdminDashboard = () => import("./features/cephAdmin/CephAdminDashboard");
const loadCephAdminAccountsPage = () => import("./features/cephAdmin/CephAdminAccountsPage");
const loadCephAdminUsersPage = () => import("./features/cephAdmin/CephAdminUsersPage");
const loadCephAdminBucketsPage = () => import("./features/cephAdmin/CephAdminBucketsPage");
const loadCephAdminBucketDetailPage = () => import("./features/cephAdmin/CephAdminBucketDetailPage");
const loadCephAdminMetricsPage = () => import("./features/cephAdmin/CephAdminMetricsPage");
const loadCephAdminBrowserPage = () => import("./features/cephAdmin/CephAdminBrowserPage");
const loadStorageOpsLayout = () => import("./features/storageOps/StorageOpsLayout");
const loadStorageOpsDashboard = () => import("./features/storageOps/StorageOpsDashboard");
const loadStorageOpsBucketsPage = () => import("./features/storageOps/StorageOpsBucketsPage");
const loadProfilePage = () => import("./features/shared/ProfilePage");

const LoginPage = lazy(loadLoginPage);
const OidcCallbackPage = lazy(loadOidcCallbackPage);
const UnauthorizedPage = lazy(loadUnauthorizedPage);
const S3AccountsPage = lazy(loadS3AccountsPage);
const AuditLogsPage = lazy(loadAuditLogsPage);
const UsersPage = lazy(loadUsersPage);
const GroupsPage = lazy(loadGroupsPage);
const AdminDashboard = lazy(loadAdminDashboard);
const AdminMetricsPage = lazy(loadAdminMetricsPage);
const BillingPage = lazy(loadBillingPage);
const UsageHistoryPage = lazy(loadUsageHistoryPage);
const S3UsersPage = lazy(loadS3UsersPage);
const S3UserKeysPage = lazy(loadS3UserKeysPage);
const S3ConnectionsPage = lazy(loadS3ConnectionsPage);
const GeneralSettingsPage = lazy(loadGeneralSettingsPage);
const ManagerSettingsPage = lazy(loadManagerSettingsPage);
const AdminPortalSettingsPage = lazy(loadAdminPortalSettingsPage);
const BrowserSettingsPage = lazy(loadBrowserSettingsPage);
const KeyRotationPage = lazy(loadKeyRotationPage);
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
const ManagerMigrationDetailPage = lazy(loadManagerMigrationDetailPage);
const ManagerMigrationWizardPage = lazy(loadManagerMigrationWizardPage);
const ManagerBucketComparePage = lazy(loadManagerBucketComparePage);
const ManagerBucketIntegrityPage = lazy(loadManagerBucketIntegrityPage);
const ManagerBucketPurgePage = lazy(loadManagerBucketPurgePage);
const ManagerFeatureRulesPage = lazy(loadManagerFeatureRulesPage);
const ManagerCephKeysPage = lazy(loadManagerCephKeysPage);
const PortalLayout = lazy(loadPortalLayout);
const PortalDashboard = lazy(loadPortalDashboard);
const PortalAccessKeysPage = lazy(loadPortalAccessKeysPage);
const PortalStorageSpacesPage = lazy(loadPortalStorageSpacesPage);
const PortalStorageSpaceDetailPage = lazy(loadPortalStorageSpaceDetailPage);
const PortalObjectDetailPage = lazy(loadPortalObjectDetailPage);
const PortalSharesPage = lazy(loadPortalSharesPage);
const PortalActivityPage = lazy(loadPortalActivityPage);
const PortalTransfersPage = lazy(loadPortalTransfersPage);
const PortalUsagePage = lazy(loadPortalUsagePage);
const PortalSettingsPage = lazy(loadPortalSettingsPage);
const BrowserLayout = lazy(loadBrowserLayout);
const CephAdminLayout = lazy(loadCephAdminLayout);
const CephAdminDashboard = lazy(loadCephAdminDashboard);
const CephAdminAccountsPage = lazy(loadCephAdminAccountsPage);
const CephAdminUsersPage = lazy(loadCephAdminUsersPage);
const CephAdminBucketsPage = lazy(loadCephAdminBucketsPage);
const CephAdminBucketDetailPage = lazy(loadCephAdminBucketDetailPage);
const CephAdminMetricsPage = lazy(loadCephAdminMetricsPage);
const CephAdminBrowserPage = lazy(loadCephAdminBrowserPage);
const StorageOpsLayout = lazy(loadStorageOpsLayout);
const StorageOpsDashboard = lazy(loadStorageOpsDashboard);
const StorageOpsBucketsPage = lazy(loadStorageOpsBucketsPage);
const ProfilePage = lazy(loadProfilePage);

const SUPERADMIN_ROLE = "ui_superadmin";
const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";
const ADMIN_SETTINGS_PATHS = [
  "/admin/general-settings",
  "/admin/manager-settings",
  "/admin/browser-settings",
  "/admin/portal-settings",
  "/admin/key-rotation",
];

function isAdminSettingsPath(pathname: string): boolean {
  return ADMIN_SETTINGS_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export const buildAdminNav = (
  portalEnabled: boolean,
  browserEnabled: boolean,
  billingEnabled: boolean,
  usageHistoryEnabled: boolean,
  endpointStatusEnabled: boolean,
  isSuperAdmin: boolean,
  settingsExpanded = false
) => {
  const settingsLinks = [
    { to: "/admin/general-settings", label: "General" },
    { to: "/admin/manager-settings", label: "Manager" },
    {
      to: "/admin/browser-settings",
      label: "Browser",
      disabled: !browserEnabled,
      disabledHint: !browserEnabled ? "Browser feature is disabled in General settings." : undefined,
    },
    {
      to: "/admin/portal-settings",
      label: "Portal",
      disabled: !portalEnabled,
      disabledHint: !portalEnabled ? "Portal feature is disabled in General settings." : undefined,
    },
    { to: "/admin/key-rotation", label: "Key Rotation" },
  ];

  return [
    {
      label: "Overview",
      links: [
        { to: "/admin", label: "Dashboard", end: true },
        { to: "/admin/metrics", label: "Usage & Metrics" },
      ],
    },
    {
      label: "Platform",
      links: [
        { to: "/admin/users", label: "UI Users" },
        { to: "/admin/groups", label: "UI Groups" },
      ],
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
      links: [{ to: "/admin/s3-connections", label: "Shared S3 Connections" }],
    },
    {
      label: "Storage Backends",
      links: [
        { to: "/admin/storage-endpoints", label: "S3 Endpoints" },
        ...(endpointStatusEnabled ? [{ to: "/admin/endpoint-status", label: "Endpoint Status" }] : []),
      ],
    },
    {
      label: "Audit & Reporting",
      links: [
        ...(billingEnabled ? [{ to: "/admin/billing", label: "Billing" }] : []),
        ...(usageHistoryEnabled ? [{ to: "/admin/usage-history", label: "Usage History" }] : []),
        { to: "/admin/audit", label: "Audit trail" },
      ],
    },
    ...(isSuperAdmin
      ? [
          {
            label: "Settings",
            links: settingsLinks,
            collapsed: !settingsExpanded,
          },
        ]
      : []),
  ];
};

function AdminLayoutShell() {
  const { generalSettings } = useGeneralSettings();
  const location = useLocation();
  const currentUser = readStoredUser();
  const canConfigureApp = isSuperAdminRole(currentUser?.role);
  const adminNav = buildAdminNav(
    generalSettings.portal_enabled,
    generalSettings.browser_enabled,
    generalSettings.billing_enabled,
    generalSettings.usage_history_enabled,
    generalSettings.endpoint_status_enabled,
    canConfigureApp,
    isAdminSettingsPath(location.pathname)
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

function AdminBillingRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.billing_enabled ? <BillingPage /> : <FeatureDisabledPage feature="Billing" />;
}

function AdminUsageHistoryRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.usage_history_enabled ? <UsageHistoryPage /> : <FeatureDisabledPage feature="Usage history" />;
}

function AdminPortalSettingsRoute() {
  const { generalSettings } = useGeneralSettings();
  return generalSettings.portal_enabled ? <AdminPortalSettingsPage /> : <FeatureDisabledPage feature="Portal" />;
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

export function createAppRoutes() {
  return createRoutesFromElements(
    <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
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
            <Route path="groups" element={<GroupsPage />} />
            <Route path="audit" element={<AuditLogsPage />} />
            <Route path="metrics" element={<AdminMetricsPage />} />
            <Route path="billing" element={<AdminBillingRoute />} />
            <Route path="usage-history" element={<AdminUsageHistoryRoute />} />
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
          <Route element={<RequireStorageOpsFeature />}>
            <Route path="/storage-ops" element={<StorageOpsLayout />}>
              <Route index element={<StorageOpsDashboard />} />
              <Route path="buckets" element={<StorageOpsBucketsPage />} />
            </Route>
          </Route>
        </Route>

        <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE, USER_ROLE]} />}>
          <Route element={<RequireManagerFeature />}>
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
              <Route path="ceph/keys" element={<ManagerCephKeysPage />} />
              <Route element={<RequireManagerBucketCompareFeature />}>
                <Route path="bucket-compare" element={<ManagerBucketComparePage />} />
              </Route>
              <Route element={<RequireManagerBucketIntegrityFeature />}>
                <Route path="bucket-integrity" element={<ManagerBucketIntegrityPage />} />
              </Route>
              <Route element={<RequireManagerBucketPurgeFeature />}>
                <Route path="bucket-purge" element={<ManagerBucketPurgePage />} />
              </Route>
              <Route element={<RequireManagerFeatureRulesTool />}>
                <Route path="feature-rules" element={<ManagerFeatureRulesPage />} />
              </Route>
              <Route element={<RequireManagerMigrationFeature />}>
                <Route path="migrations" element={<ManagerMigrationsPage />} />
                <Route path="migrations/new" element={<ManagerMigrationWizardPage />} />
                <Route path="migrations/:migrationId" element={<ManagerMigrationDetailPage />} />
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
          <Route element={<RequirePortalAccess />}>
            <Route path="/portal" element={<PortalLayout />}>
              <Route index element={<PortalDashboard />} />
              <Route path="storage-spaces" element={<PortalStorageSpacesPage />} />
              <Route path="storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
              <Route path="storage-spaces/:spaceId" element={<PortalStorageSpaceDetailPage />} />
              <Route path="access-keys" element={<PortalAccessKeysPage />} />
              <Route path="shares" element={<PortalSharesPage />} />
              <Route path="activity" element={<PortalActivityPage />} />
              <Route path="transfers" element={<PortalTransfersPage />} />
              <Route path="usage" element={<PortalUsagePage />} />
              <Route path="settings" element={<PortalSettingsPage />} />
            </Route>
          </Route>
        </Route>
      </Route>

      <Route path="/login" element={<LoginPage />} />
      <Route path="/oidc/:provider/callback" element={<OidcCallbackPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  );
}

export default function AppRouter() {
  const router = useMemo(() => {
    return createBrowserRouter(createAppRoutes(), {
      future: { v7_relativeSplatPath: true, v7_startTransition: true },
    });
  }, []);
  return (
    <Suspense fallback={<RouteFallback />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}

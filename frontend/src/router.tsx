/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Suspense, lazy, useMemo } from "react";
import { Navigate, Outlet, Route, RouterProvider, createBrowserRouter, createRoutesFromElements, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { useGeneralSettings } from "./components/GeneralSettingsContext";
import FeatureDisabledPage from "./features/shared/FeatureDisabledPage";
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
import {
  ADMIN_PAGE_CONTRACTS,
  workspacePageLink,
} from "./navigation/workspacePages";

export { RequireManagerFeatureRulesTool, RequirePortalAccess } from "./routerGuards";

const LoginPage = lazy(() => import("./features/auth/LoginPage"));
const OidcCallbackPage = lazy(() => import("./features/auth/OidcCallbackPage"));
const UnauthorizedPage = lazy(() => import("./features/auth/UnauthorizedPage"));
const S3AccountsPage = lazy(() => import("./features/admin/AccountsPage"));
const AuditLogsPage = lazy(() => import("./features/admin/AuditLogsPage"));
const UsersPage = lazy(() => import("./features/admin/UsersPage"));
const GroupsPage = lazy(() => import("./features/admin/GroupsPage"));
const AdminDashboard = lazy(() => import("./features/admin/AdminDashboard"));
const AdminMetricsPage = lazy(() => import("./features/admin/AdminMetricsPage"));
const AdminPortalRequestsPage = lazy(() => import("./features/admin/AdminPortalRequestsPage"));
const BillingPage = lazy(() => import("./features/admin/BillingPage"));
const UsageHistoryPage = lazy(() => import("./features/admin/UsageHistoryPage"));
const ApiTokensPage = lazy(() => import("./features/admin/ApiTokensPage"));
const S3UsersPage = lazy(() => import("./features/admin/S3UsersPage"));
const S3UserKeysPage = lazy(() => import("./features/admin/S3UserKeysPage"));
const S3ConnectionsPage = lazy(() => import("./features/admin/S3ConnectionsPage"));
const GeneralSettingsPage = lazy(() => import("./features/admin/GeneralSettingsPage"));
const AuthenticationSettingsPage = lazy(() => import("./features/admin/AuthenticationSettingsPage"));
const ManagerSettingsPage = lazy(() => import("./features/admin/ManagerSettingsPage"));
const AdminPortalSettingsPage = lazy(() => import("./features/admin/PortalSettingsPage"));
const BrowserSettingsPage = lazy(() => import("./features/admin/BrowserSettingsPage"));
const KeyRotationPage = lazy(() => import("./features/admin/KeyRotationPage"));
const BucketsPage = lazy(() => import("./features/manager/BucketsPage"));
const ManagerDashboard = lazy(() => import("./features/manager/ManagerDashboard"));
const PoliciesPage = lazy(() => import("./features/manager/PoliciesPage"));
const ManagerLayout = lazy(() => import("./features/manager/ManagerLayout"));
const StorageEndpointsPage = lazy(() => import("./features/admin/StorageEndpointsPage"));
const EndpointStatusPage = lazy(() => import("./features/admin/EndpointStatusPage"));
const EndpointStatusDetailPage = lazy(() => import("./features/admin/EndpointStatusDetailPage"));
const ManagerUsersPage = lazy(() => import("./features/manager/ManagerUsersPage"));
const ManagerUserKeysPage = lazy(() => import("./features/manager/ManagerUserKeysPage"));
const BucketDetailPage = lazy(() => import("./features/manager/BucketDetailPage"));
const BrowserPage = lazy(() => import("./features/browser/BrowserPage"));
const ManagerBrowserPage = lazy(() => import("./features/manager/ManagerBrowserPage"));
const ManagerGroupsPage = lazy(() => import("./features/manager/ManagerGroupsPage"));
const ManagerGroupUsersPage = lazy(() => import("./features/manager/ManagerGroupUsersPage"));
const ManagerRolesPage = lazy(() => import("./features/manager/ManagerRolesPage"));
const ManagerRolePoliciesPage = lazy(() => import("./features/manager/ManagerRolePoliciesPage"));
const ManagerUserPoliciesPage = lazy(() => import("./features/manager/ManagerUserPoliciesPage"));
const ManagerGroupPoliciesPage = lazy(() => import("./features/manager/ManagerGroupPoliciesPage"));
const ManagerMetricsPage = lazy(() => import("./features/manager/ManagerMetricsPage"));
const TopicsPage = lazy(() => import("./features/manager/TopicsPage"));
const ManagerMigrationsPage = lazy(() => import("./features/manager/ManagerMigrationsPage"));
const ManagerMigrationDetailPage = lazy(() => import("./features/manager/ManagerMigrationDetailPage"));
const ManagerMigrationWizardPage = lazy(() => import("./features/manager/ManagerMigrationWizardPage"));
const ManagerBucketComparePage = lazy(() => import("./features/manager/ManagerBucketComparePage"));
const ManagerBucketIntegrityPage = lazy(() => import("./features/manager/ManagerBucketIntegrityPage"));
const ManagerBucketPurgePage = lazy(() => import("./features/manager/ManagerBucketPurgePage"));
const ManagerFeatureRulesPage = lazy(() => import("./features/manager/ManagerFeatureRulesPage"));
const ManagerCephKeysPage = lazy(() => import("./features/manager/ManagerCephKeysPage"));
const PortalLayout = lazy(() => import("./features/portal/PortalLayout"));
const PortalDashboard = lazy(() => import("./features/portal/PortalDashboard"));
const PortalAccessKeysPage = lazy(() => import("./features/portal/PortalAccessKeysPage"));
const PortalStorageSpacesPage = lazy(() => import("./features/portal/PortalStorageSpacesPage"));
const PortalStorageSpaceDetailPage = lazy(() => import("./features/portal/PortalStorageSpaceDetailPage"));
const PortalObjectDetailPage = lazy(() => import("./features/portal/PortalObjectDetailPage"));
const PortalSharesPage = lazy(() => import("./features/portal/PortalSharesPage"));
const PortalCollaboratorAccessPage = lazy(() => import("./features/portal/PortalCollaboratorAccessPage"));
const PortalRequestsPage = lazy(() => import("./features/portal/PortalRequestsPage"));
const PortalHistoryPage = lazy(() => import("./features/portal/PortalHistoryPage"));
const PortalUsagePage = lazy(() => import("./features/portal/PortalUsagePage"));
const PortalSettingsPage = lazy(() => import("./features/portal/PortalSettingsPage"));
const BrowserLayout = lazy(() => import("./features/browser/BrowserLayout"));
const CephAdminLayout = lazy(() => import("./features/cephAdmin/CephAdminLayout"));
const CephAdminDashboard = lazy(() => import("./features/cephAdmin/CephAdminDashboard"));
const CephAdminAccountsPage = lazy(() => import("./features/cephAdmin/CephAdminAccountsPage"));
const CephAdminUsersPage = lazy(() => import("./features/cephAdmin/CephAdminUsersPage"));
const CephAdminBucketsPage = lazy(() => import("./features/cephAdmin/CephAdminBucketsPage"));
const CephAdminBucketDetailPage = lazy(() => import("./features/cephAdmin/CephAdminBucketDetailPage"));
const CephAdminMetricsPage = lazy(() => import("./features/cephAdmin/CephAdminMetricsPage"));
const CephAdminBrowserPage = lazy(() => import("./features/cephAdmin/CephAdminBrowserPage"));
const StorageOpsLayout = lazy(() => import("./features/storageOps/StorageOpsLayout"));
const StorageOpsDashboard = lazy(() => import("./features/storageOps/StorageOpsDashboard"));
const StorageOpsBucketsPage = lazy(() => import("./features/storageOps/StorageOpsBucketsPage"));
const StorageOpsBucketDetailPage = lazy(() => import("./features/storageOps/StorageOpsBucketDetailPage"));
const AccountProfilePage = lazy(() => import("./features/shared/AccountProfilePage"));

const SUPERADMIN_ROLE = "ui_superadmin";
const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";
const ADMIN_SETTINGS_PATHS = [
  "/admin/general-settings",
  "/admin/authentication-settings",
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
    workspacePageLink(ADMIN_PAGE_CONTRACTS["general-settings"]),
    workspacePageLink(ADMIN_PAGE_CONTRACTS["authentication-settings"]),
    workspacePageLink(ADMIN_PAGE_CONTRACTS["manager-settings"]),
    {
      ...workspacePageLink(ADMIN_PAGE_CONTRACTS["browser-settings"]),
      disabled: !browserEnabled,
      disabledHint: !browserEnabled ? "Browser feature is disabled in General settings." : undefined,
    },
    {
      ...workspacePageLink(ADMIN_PAGE_CONTRACTS["portal-settings"]),
      disabled: !portalEnabled,
      disabledHint: !portalEnabled ? "Portal feature is disabled in General settings." : undefined,
    },
    workspacePageLink(ADMIN_PAGE_CONTRACTS["key-rotation"]),
  ];

  return [
    {
      label: "Overview",
      links: [{ ...workspacePageLink(ADMIN_PAGE_CONTRACTS.dashboard), end: true }],
    },
    {
      label: "Platform",
      links: [
        workspacePageLink(ADMIN_PAGE_CONTRACTS.users),
        workspacePageLink(ADMIN_PAGE_CONTRACTS.groups),
      ],
    },
    {
      label: "Managed Tenants",
      links: [
        workspacePageLink(ADMIN_PAGE_CONTRACTS.accounts),
        workspacePageLink(ADMIN_PAGE_CONTRACTS["rgw-users"]),
        workspacePageLink(ADMIN_PAGE_CONTRACTS.metrics),
      ],
    },
    {
      label: "Connections",
      links: [workspacePageLink(ADMIN_PAGE_CONTRACTS["shared-connections"])],
    },
    {
      label: "Storage Backends",
      links: [
        workspacePageLink(ADMIN_PAGE_CONTRACTS["storage-endpoints"]),
        ...(endpointStatusEnabled ? [workspacePageLink(ADMIN_PAGE_CONTRACTS["endpoint-status"])] : []),
      ],
    },
    {
      label: "Audit & Reporting",
      links: [
        ...(portalEnabled ? [workspacePageLink(ADMIN_PAGE_CONTRACTS["portal-requests"])] : []),
        ...(billingEnabled ? [workspacePageLink(ADMIN_PAGE_CONTRACTS.billing)] : []),
        ...(usageHistoryEnabled ? [workspacePageLink(ADMIN_PAGE_CONTRACTS["usage-history"])] : []),
        workspacePageLink(ADMIN_PAGE_CONTRACTS.audit),
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
        <Route path="/profile" element={<Navigate to="/" replace />} />

        <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE]} />}>
          <Route path="/admin" element={<AdminLayoutShell />}>
            <Route index element={<AdminDashboard />} />
            <Route path="profile" element={<AccountProfilePage />} />
            <Route path="s3-accounts" element={<S3AccountsPage />} />
            <Route path="accounts" element={<Navigate to="/admin/s3-accounts" replace />} />
            <Route path="s3-users" element={<S3UsersPage />} />
            <Route path="s3-connections" element={<S3ConnectionsPage />} />
            <Route path="s3-users/:userId/keys" element={<S3UserKeysPage />} />
            <Route path="storage-endpoints" element={<StorageEndpointsPage />} />
            <Route path="storage-endpoints/:endpointId" element={<StorageEndpointsPage />} />
            <Route path="endpoint-status" element={<AdminEndpointStatusRoute />} />
            <Route path="endpoint-status/:endpointId" element={<AdminEndpointStatusDetailRoute />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="audit" element={<AuditLogsPage />} />
            <Route path="metrics" element={<AdminMetricsPage />} />
            <Route path="portal-requests" element={<AdminPortalRequestsPage />} />
            <Route path="billing" element={<AdminBillingRoute />} />
            <Route path="usage-history" element={<AdminUsageHistoryRoute />} />
            <Route element={<RequireRole roles={[SUPERADMIN_ROLE]} />}>
              <Route path="general-settings" element={<GeneralSettingsPage />} />
              <Route path="authentication-settings" element={<AuthenticationSettingsPage />} />
              <Route path="manager-settings" element={<ManagerSettingsPage />} />
              <Route path="portal-settings" element={<AdminPortalSettingsRoute />} />
              <Route path="browser-settings" element={<BrowserSettingsPage />} />
              <Route path="key-rotation" element={<KeyRotationPage />} />
              <Route path="api-tokens" element={<ApiTokensPage />} />
            </Route>
          </Route>
        </Route>

        <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE]} />}>
          <Route element={<RequireCephAdminFeature />}>
            <Route path="/ceph-admin" element={<CephAdminLayout />}>
              <Route index element={<CephAdminDashboard />} />
              <Route path="profile" element={<AccountProfilePage />} />
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
              <Route path="profile" element={<AccountProfilePage />} />
              <Route path="buckets" element={<StorageOpsBucketsPage />} />
              <Route path="buckets/:bucketName" element={<StorageOpsBucketDetailPage />} />
            </Route>
          </Route>
        </Route>

        <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE, USER_ROLE]} />}>
          <Route element={<RequireManagerFeature />}>
            <Route path="/manager" element={<ManagerLayout />}>
              <Route index element={<ManagerDashboard />} />
              <Route path="profile" element={<AccountProfilePage />} />
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
              <Route path="profile" element={<AccountProfilePage />} />
            </Route>
          </Route>
        </Route>

        <Route element={<RequireRole roles={[SUPERADMIN_ROLE, ADMIN_ROLE, USER_ROLE]} />}>
          <Route element={<RequirePortalAccess />}>
            <Route path="/portal" element={<PortalLayout />}>
              <Route index element={<PortalDashboard />} />
              <Route path="profile" element={<AccountProfilePage />} />
              <Route path="storage-spaces" element={<PortalStorageSpacesPage />} />
              <Route path="storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
              <Route path="storage-spaces/:spaceId" element={<PortalStorageSpaceDetailPage />} />
              <Route path="access-keys" element={<PortalAccessKeysPage />} />
              <Route path="shares" element={<PortalSharesPage />} />
              <Route path="shares/:userId" element={<PortalCollaboratorAccessPage />} />
              <Route path="requests" element={<PortalRequestsPage />} />
              <Route path="history" element={<PortalHistoryPage />} />
              <Route path="transfers" element={<Navigate to="/portal/history" replace />} />
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
      future: { v7_relativeSplatPath: true },
    });
  }, []);
  return (
    <Suspense fallback={<RouteFallback />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}

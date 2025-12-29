/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import LoginPage from "./features/auth/LoginPage";
import OidcCallbackPage from "./features/auth/OidcCallbackPage";
import UnauthorizedPage from "./features/auth/UnauthorizedPage";
import S3AccountsPage from "./features/admin/AccountsPage";
import AuditLogsPage from "./features/admin/AuditLogsPage";
import UsersPage from "./features/admin/UsersPage";
import AdminDashboard from "./features/admin/AdminDashboard";
import AdminMetricsPage from "./features/admin/AdminMetricsPage";
import S3UsersPage from "./features/admin/S3UsersPage";
import S3UserKeysPage from "./features/admin/S3UserKeysPage";
import PortalSettingsPage from "./features/admin/PortalSettingsPage";
import BrowserSettingsPage from "./features/admin/BrowserSettingsPage";
import BucketsPage from "./features/manager/BucketsPage";
import ManagerDashboard from "./features/manager/ManagerDashboard";
import PoliciesPage from "./features/manager/PoliciesPage";
import ManagerLayout from "./features/manager/ManagerLayout";
import StorageEndpointsPage from "./features/admin/StorageEndpointsPage";
import ManagerUsersPage from "./features/manager/ManagerUsersPage";
import ManagerUserKeysPage from "./features/manager/ManagerUserKeysPage";
import BucketDetailPage from "./features/manager/BucketDetailPage";
import BrowserPage from "./features/browser/BrowserPage";
import ManagerGroupsPage from "./features/manager/ManagerGroupsPage";
import ManagerGroupUsersPage from "./features/manager/ManagerGroupUsersPage";
import ManagerRolesPage from "./features/manager/ManagerRolesPage";
import ManagerRolePoliciesPage from "./features/manager/ManagerRolePoliciesPage";
import ManagerUserPoliciesPage from "./features/manager/ManagerUserPoliciesPage";
import ManagerGroupPoliciesPage from "./features/manager/ManagerGroupPoliciesPage";
import ManagerMetricsPage from "./features/manager/ManagerMetricsPage";
import TopicsPage from "./features/manager/TopicsPage";
import PortalLayout from "./features/portal/PortalLayout";
import PortalDashboard from "./features/portal/PortalDashboard";
import BrowserLayout from "./features/browser/BrowserLayout";

const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";
const UNASSIGNED_ROLE = "ui_none";

type StoredUser = {
  role?: string | null;
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

const adminNav = [
  {
    label: "Overview",
    links: [
      { to: "/admin", label: "Dashboard", end: true },
      { to: "/admin/metrics", label: "Metrics" },
    ],
  },
  {
    label: "Interface",
    links: [{ to: "/admin/users", label: "UI Users" }],
  },
  {
    label: "Storage",
    links: [
      { to: "/admin/storage-endpoints", label: "Endpoints" },
      { to: "/admin/s3-accounts", label: "Accounts" },
      { to: "/admin/s3-users", label: "Users" },
    ],
  },
  {
    label: "Governance",
    links: [{ to: "/admin/audit", label: "Audit trail" }],
  },
  {
    label: "Settings",
    links: [
      { to: "/admin/portal-settings", label: "Portal" },
      { to: "/admin/browser-settings", label: "Browser" },
    ],
  },
];

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

function RequireRole({ roles }: { roles: string[] }) {
  const user = getStoredUser();
  if (!user || !user.role) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}

function RoleRedirect() {
  const user = getStoredUser();
  if (!user || !user.role) return <Navigate to="/login" replace />;
  if (user.role === ADMIN_ROLE) return <Navigate to="/admin" replace />;
  if (user.role === USER_ROLE) {
    const links = user.account_links ?? [];
    const hasPortalAccess = links.some((link) => link.account_role !== "portal_none");
    const hasAccountAdmin = links.some((link) => link.account_admin);
    if (hasPortalAccess) return <Navigate to="/portal" replace />;
    if (hasAccountAdmin) return <Navigate to="/manager" replace />;
    return <Navigate to="/unauthorized" replace />;
  }
  if (user.role === UNASSIGNED_ROLE) return <Navigate to="/unauthorized" replace />;
  return <Navigate to="/unauthorized" replace />;
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route index element={<RoleRedirect />} />

          <Route element={<RequireRole roles={[ADMIN_ROLE]} />}>
            <Route
              path="/admin"
              element={
                <Layout
                  navSections={adminNav}
                  sidebarTitle="ADMIN"
                  hideHeader
                  topbarContent={
                    <span className="text-sm text-slate-500 dark:text-slate-300">Administration globale</span>
                  }
                />
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="s3-accounts" element={<S3AccountsPage />} />
              <Route path="accounts" element={<Navigate to="/admin/s3-accounts" replace />} />
              <Route path="s3-users" element={<S3UsersPage />} />
              <Route path="s3-users/:userId/keys" element={<S3UserKeysPage />} />
              <Route path="storage-endpoints" element={<StorageEndpointsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="audit" element={<AuditLogsPage />} />
              <Route path="metrics" element={<AdminMetricsPage />} />
              <Route path="portal-settings" element={<PortalSettingsPage />} />
              <Route path="browser-settings" element={<BrowserSettingsPage />} />
            </Route>
          </Route>

          <Route element={<RequireRole roles={[ADMIN_ROLE, USER_ROLE]} />}>
            <Route
              path="/manager"
              element={<ManagerLayout />}
            >
              <Route index element={<ManagerDashboard />} />
              <Route path="buckets" element={<BucketsPage />} />
              <Route path="buckets/:bucketName" element={<BucketDetailPage />} />
              <Route path="users" element={<ManagerUsersPage />} />
              <Route path="users/:userName/keys" element={<ManagerUserKeysPage />} />
              <Route path="users/:userName/policies" element={<ManagerUserPoliciesPage />} />
              <Route path="metrics" element={<ManagerMetricsPage />} />
              <Route path="groups" element={<ManagerGroupsPage />} />
              <Route path="groups/:groupName/policies" element={<ManagerGroupPoliciesPage />} />
              <Route path="groups/:groupName/users" element={<ManagerGroupUsersPage />} />
              <Route path="roles" element={<ManagerRolesPage />} />
              <Route path="roles/:roleName/policies" element={<ManagerRolePoliciesPage />} />
              <Route path="iam/policies" element={<PoliciesPage />} />
              <Route path="topics" element={<TopicsPage />} />
            </Route>

            <Route
              path="/browser"
              element={<BrowserLayout />}
            >
              <Route index element={<BrowserPage />} />
            </Route>
          </Route>

          <Route element={<RequireRole roles={[ADMIN_ROLE, USER_ROLE]} />}>
            <Route
              path="/portal"
              element={<PortalLayout />}
            >
              <Route index element={<PortalDashboard />} />
            </Route>
          </Route>
        </Route>

        <Route path="/login" element={<LoginPage />} />
        <Route path="/oidc/:provider/callback" element={<OidcCallbackPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

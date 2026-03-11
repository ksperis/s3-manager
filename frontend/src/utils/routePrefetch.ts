/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export function prefetchWorkspaceBranch(pathname: string): void {
  if (pathname.startsWith("/admin")) {
    void Promise.allSettled([
      import("../features/admin/AdminDashboard"),
      import("../features/admin/AccountsPage"),
      import("../features/admin/UsersPage"),
    ]);
    return;
  }
  if (pathname.startsWith("/manager")) {
    void Promise.allSettled([
      import("../features/manager/ManagerLayout"),
      import("../features/manager/ManagerDashboard"),
      import("../features/manager/BucketsPage"),
      import("../features/manager/ManagerMetricsPage"),
    ]);
    return;
  }
  if (pathname.startsWith("/portal")) {
    void Promise.allSettled([
      import("../features/portal/PortalLayout"),
      import("../features/portal/PortalDashboard"),
      import("../features/portal/PortalManagePage"),
    ]);
    return;
  }
  if (pathname.startsWith("/ceph-admin")) {
    void Promise.allSettled([
      import("../features/cephAdmin/CephAdminLayout"),
      import("../features/cephAdmin/CephAdminDashboard"),
      import("../features/cephAdmin/CephAdminBucketsPage"),
    ]);
    return;
  }
  if (pathname.startsWith("/storage-ops")) {
    void Promise.allSettled([
      import("../features/storageOps/StorageOpsLayout"),
      import("../features/storageOps/StorageOpsDashboard"),
      import("../features/storageOps/StorageOpsBucketsPage"),
    ]);
    return;
  }
  if (pathname.startsWith("/browser")) {
    void Promise.allSettled([import("../features/browser/BrowserLayout"), import("../features/browser/BrowserPage")]);
  }
}

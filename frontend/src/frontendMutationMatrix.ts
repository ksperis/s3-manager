/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type FrontendMutationMatrixRow = {
  id: string;
  surface: "admin" | "manager" | "portal" | "browser" | "ceph-admin" | "storage-ops";
  workflow: string;
  representativeFiles: string[];
  hasLoadingState: boolean;
  hasUserFeedback: boolean;
  destructiveConfirmation: "required" | "not_destructive" | "backend_guarded";
  auditContextSource: "backend_route" | "stream_route" | "backend_service";
};

export const FRONTEND_MUTATION_MATRIX: FrontendMutationMatrixRow[] = [
  {
    id: "admin-users-groups",
    surface: "admin",
    workflow: "UI users, groups, associations, settings, and endpoint governance",
    representativeFiles: ["features/admin/UsersPage.tsx", "features/admin/GroupsPage.tsx", "features/admin/StorageEndpointsPage.tsx"],
    hasLoadingState: true,
    hasUserFeedback: true,
    destructiveConfirmation: "required",
    auditContextSource: "backend_route",
  },
  {
    id: "manager-iam",
    surface: "manager",
    workflow: "IAM users, groups, roles, policies, topics, Ceph keys, and bucket features",
    representativeFiles: ["features/manager/ManagerUsersPage.tsx", "features/manager/ManagerRolesPage.tsx", "features/manager/BucketDetailPage.tsx"],
    hasLoadingState: true,
    hasUserFeedback: true,
    destructiveConfirmation: "required",
    auditContextSource: "backend_route",
  },
  {
    id: "manager-tools",
    surface: "manager",
    workflow: "bucket compare, integrity, purge, migration, and feature-rule tools",
    representativeFiles: ["features/manager/ManagerBucketCompareModal.tsx", "features/manager/migrations/ManagerMigrationWizardPage.tsx"],
    hasLoadingState: true,
    hasUserFeedback: true,
    destructiveConfirmation: "backend_guarded",
    auditContextSource: "stream_route",
  },
  {
    id: "browser-objects",
    surface: "browser",
    workflow: "object upload, download preparation, delete, copy, move, restore, and metadata changes",
    representativeFiles: ["features/browser/BrowserPage.tsx", "features/browser/BrowserObjectDetailsModal.tsx"],
    hasLoadingState: true,
    hasUserFeedback: true,
    destructiveConfirmation: "required",
    auditContextSource: "backend_route",
  },
  {
    id: "portal-storage-spaces",
    surface: "portal",
    workflow: "Storage Space create, archive, restore, shares, public links, profile, and access keys",
    representativeFiles: ["features/portal/PortalStorageSpacesPage.tsx", "features/portal/PortalSharesPage.tsx", "features/portal/PortalAccessKeysPage.tsx"],
    hasLoadingState: true,
    hasUserFeedback: true,
    destructiveConfirmation: "required",
    auditContextSource: "backend_service",
  },
  {
    id: "ceph-admin-ops",
    surface: "ceph-admin",
    workflow: "endpoint-wide accounts, users, buckets, quota, keys, and embedded Browser actions",
    representativeFiles: ["features/cephAdmin/CephAdminAccountsPage.tsx", "features/cephAdmin/CephAdminUserEditModal.tsx"],
    hasLoadingState: true,
    hasUserFeedback: true,
    destructiveConfirmation: "required",
    auditContextSource: "backend_route",
  },
  {
    id: "storage-ops-buckets",
    surface: "storage-ops",
    workflow: "cross-account bucket inventory, selection actions, integrity, purge, and export",
    representativeFiles: ["features/storageOps/StorageOpsBucketsPage.tsx", "features/shared/BucketOpsWorkbench.tsx"],
    hasLoadingState: true,
    hasUserFeedback: true,
    destructiveConfirmation: "backend_guarded",
    auditContextSource: "stream_route",
  },
];

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../components/PageHeader";
import type { WorkspaceId } from "../utils/workspaces";

type WorkspaceContract = {
  label: string;
  path: string;
};

export type WorkspacePageContract = {
  label: string;
  path: string;
};

export const WORKSPACE_CONTRACTS: Record<WorkspaceId, WorkspaceContract> = {
  admin: { label: "Admin", path: "/admin" },
  "ceph-admin": { label: "Ceph Admin", path: "/ceph-admin" },
  manager: { label: "Manager", path: "/manager" },
  portal: { label: "Portal", path: "/portal" },
  "storage-ops": { label: "Storage Ops", path: "/storage-ops" },
  browser: { label: "Browser", path: "/browser" },
};

export function resolveWorkspaceIdFromPath(
  pathname: string,
  fallback: WorkspaceId = "admin",
): WorkspaceId {
  const segment = pathname.split("/")[1] as WorkspaceId | undefined;
  return segment && Object.prototype.hasOwnProperty.call(WORKSPACE_CONTRACTS, segment)
    ? segment
    : fallback;
}

export const ADMIN_PAGE_CONTRACTS = {
  dashboard: { label: "Dashboard", path: "/admin" },
  metrics: { label: "Usage & Metrics", path: "/admin/metrics" },
  users: { label: "UI Users", path: "/admin/users" },
  groups: { label: "UI Groups", path: "/admin/groups" },
  accounts: { label: "RGW Accounts", path: "/admin/s3-accounts" },
  "rgw-users": { label: "RGW Users", path: "/admin/s3-users" },
  "shared-connections": { label: "Shared S3 Connections", path: "/admin/s3-connections" },
  "storage-endpoints": { label: "S3 Endpoints", path: "/admin/storage-endpoints" },
  "endpoint-status": { label: "Endpoint Status", path: "/admin/endpoint-status" },
  "portal-requests": { label: "Portal Requests", path: "/admin/portal-requests" },
  billing: { label: "Billing", path: "/admin/billing" },
  "usage-history": { label: "Usage History", path: "/admin/usage-history" },
  audit: { label: "Audit trail", path: "/admin/audit" },
  "general-settings": { label: "General", path: "/admin/general-settings" },
  "authentication-settings": { label: "Authentication", path: "/admin/authentication-settings" },
  "manager-settings": { label: "Manager", path: "/admin/manager-settings" },
  "browser-settings": { label: "Browser", path: "/admin/browser-settings" },
  "portal-settings": { label: "Portal", path: "/admin/portal-settings" },
  "key-rotation": { label: "Key Rotation", path: "/admin/key-rotation" },
  "api-tokens": { label: "API tokens", path: "/admin/api-tokens" },
  profile: { label: "Profile", path: "/admin/profile" },
} as const satisfies Record<string, WorkspacePageContract>;

export const MANAGER_PAGE_CONTRACTS = {
  dashboard: { label: "Dashboard", path: "/manager" },
  metrics: { label: "Usage & Metrics", path: "/manager/metrics" },
  buckets: { label: "Buckets", path: "/manager/buckets" },
  browser: { label: "Browser", path: "/manager/browser" },
  topics: { label: "SNS Topics", path: "/manager/topics" },
  users: { label: "Users", path: "/manager/users" },
  groups: { label: "Groups", path: "/manager/groups" },
  roles: { label: "Roles", path: "/manager/roles" },
  policies: { label: "Policies", path: "/manager/iam/policies" },
  "ceph-keys": { label: "Access keys", path: "/manager/ceph/keys" },
  "feature-rules": { label: "Feature rules", path: "/manager/feature-rules" },
  compare: { label: "Compare", path: "/manager/bucket-compare" },
  integrity: { label: "Integrity", path: "/manager/bucket-integrity" },
  purge: { label: "Purge", path: "/manager/bucket-purge" },
  migration: { label: "Migration", path: "/manager/migrations" },
  profile: { label: "Profile", path: "/manager/profile" },
} as const satisfies Record<string, WorkspacePageContract>;

export const CEPH_ADMIN_PAGE_CONTRACTS = {
  dashboard: { label: "Dashboard", path: "/ceph-admin" },
  metrics: { label: "Usage & Metrics", path: "/ceph-admin/metrics" },
  accounts: { label: "RGW Accounts", path: "/ceph-admin/accounts" },
  users: { label: "RGW Users", path: "/ceph-admin/users" },
  buckets: { label: "Buckets", path: "/ceph-admin/buckets" },
  browser: { label: "Browser", path: "/ceph-admin/browser" },
  profile: { label: "Profile", path: "/ceph-admin/profile" },
} as const satisfies Record<string, WorkspacePageContract>;

export const STORAGE_OPS_PAGE_CONTRACTS = {
  dashboard: { label: "Dashboard", path: "/storage-ops" },
  buckets: { label: "Buckets", path: "/storage-ops/buckets" },
  profile: { label: "Profile", path: "/storage-ops/profile" },
} as const satisfies Record<string, WorkspacePageContract>;

export function buildWorkspaceBreadcrumbs(
  workspace: WorkspaceId,
  ...breadcrumbs: PageBreadcrumb[]
): PageBreadcrumb[] {
  const root = WORKSPACE_CONTRACTS[workspace];
  return [
    breadcrumbs.length > 0 ? { label: root.label, to: root.path } : { label: root.label },
    ...breadcrumbs,
  ];
}

export function buildWorkspacePageBreadcrumbs(
  workspace: WorkspaceId,
  page: WorkspacePageContract,
  ...trailingBreadcrumbs: PageBreadcrumb[]
): PageBreadcrumb[] {
  const pageBreadcrumb =
    trailingBreadcrumbs.length > 0 ? { label: page.label, to: page.path } : { label: page.label };
  return buildWorkspaceBreadcrumbs(workspace, pageBreadcrumb, ...trailingBreadcrumbs);
}

export function workspacePageLink(page: WorkspacePageContract): { to: string; label: string } {
  return { to: page.path, label: page.label };
}

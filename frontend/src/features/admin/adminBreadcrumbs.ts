/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";
import {
  ADMIN_PAGE_CONTRACTS as ADMIN_NAVIGATION_CONTRACTS,
  buildWorkspaceBreadcrumbs,
  buildWorkspacePageBreadcrumbs,
  type WorkspacePageContract,
} from "../../navigation/workspacePages";

export function adminBreadcrumbs(...breadcrumbs: PageBreadcrumb[]): PageBreadcrumb[] {
  return buildWorkspaceBreadcrumbs("admin", ...breadcrumbs);
}

export type AdminPageId = keyof typeof ADMIN_NAVIGATION_CONTRACTS;
type GovernedAdminPageId =
  | "accounts"
  | "groups"
  | "rgw-users"
  | "shared-connections"
  | "storage-endpoints"
  | "users";

export type AdminPageContract = {
  title: string;
  navigation: WorkspacePageContract;
  governanceArea: "accounts" | "connections" | "endpoints" | "identity";
};

export const ADMIN_PAGE_CONTRACTS: Record<GovernedAdminPageId, AdminPageContract> = {
  accounts: {
    title: ADMIN_NAVIGATION_CONTRACTS.accounts.label,
    navigation: ADMIN_NAVIGATION_CONTRACTS.accounts,
    governanceArea: "accounts",
  },
  groups: {
    title: ADMIN_NAVIGATION_CONTRACTS.groups.label,
    navigation: ADMIN_NAVIGATION_CONTRACTS.groups,
    governanceArea: "identity",
  },
  "rgw-users": {
    title: ADMIN_NAVIGATION_CONTRACTS["rgw-users"].label,
    navigation: ADMIN_NAVIGATION_CONTRACTS["rgw-users"],
    governanceArea: "accounts",
  },
  "shared-connections": {
    title: ADMIN_NAVIGATION_CONTRACTS["shared-connections"].label,
    navigation: ADMIN_NAVIGATION_CONTRACTS["shared-connections"],
    governanceArea: "connections",
  },
  "storage-endpoints": {
    title: ADMIN_NAVIGATION_CONTRACTS["storage-endpoints"].label,
    navigation: ADMIN_NAVIGATION_CONTRACTS["storage-endpoints"],
    governanceArea: "endpoints",
  },
  users: {
    title: ADMIN_NAVIGATION_CONTRACTS.users.label,
    navigation: ADMIN_NAVIGATION_CONTRACTS.users,
    governanceArea: "identity",
  },
};

export function adminPageBreadcrumbs(
  pageId: AdminPageId,
  ...trailingBreadcrumbs: PageBreadcrumb[]
): PageBreadcrumb[] {
  return buildWorkspacePageBreadcrumbs(
    "admin",
    ADMIN_NAVIGATION_CONTRACTS[pageId],
    ...trailingBreadcrumbs,
  );
}

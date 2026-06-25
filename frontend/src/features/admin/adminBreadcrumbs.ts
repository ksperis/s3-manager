/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";

const ADMIN_BREADCRUMB: PageBreadcrumb = { label: "Admin" };

export function adminBreadcrumbs(...breadcrumbs: PageBreadcrumb[]): PageBreadcrumb[] {
  return [ADMIN_BREADCRUMB, ...breadcrumbs];
}

export type AdminPageId =
  | "accounts"
  | "groups"
  | "shared-connections"
  | "storage-endpoints"
  | "users";

export type AdminPageContract = {
  title: string;
  breadcrumbs: PageBreadcrumb[];
  governanceArea: "accounts" | "connections" | "endpoints" | "identity";
};

export const ADMIN_PAGE_CONTRACTS: Record<AdminPageId, AdminPageContract> = {
  accounts: {
    title: "Accounts",
    breadcrumbs: [{ label: "Accounts" }],
    governanceArea: "accounts",
  },
  groups: {
    title: "UI Groups",
    breadcrumbs: [{ label: "Platform" }, { label: "UI Groups" }],
    governanceArea: "identity",
  },
  "shared-connections": {
    title: "Shared S3 Connections",
    breadcrumbs: [{ label: "Shared S3 Connections" }],
    governanceArea: "connections",
  },
  "storage-endpoints": {
    title: "Storage endpoints",
    breadcrumbs: [{ label: "Endpoints" }],
    governanceArea: "endpoints",
  },
  users: {
    title: "UI Users",
    breadcrumbs: [{ label: "Interface" }, { label: "UI Users" }],
    governanceArea: "identity",
  },
};

export function adminPageBreadcrumbs(pageId: AdminPageId): PageBreadcrumb[] {
  return adminBreadcrumbs(...ADMIN_PAGE_CONTRACTS[pageId].breadcrumbs);
}

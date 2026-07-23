/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";
import {
  CEPH_ADMIN_PAGE_CONTRACTS,
  buildWorkspacePageBreadcrumbs,
} from "../../navigation/workspacePages";

export type CephAdminPageId = keyof typeof CEPH_ADMIN_PAGE_CONTRACTS;

export function cephAdminPageBreadcrumbs(
  pageId: CephAdminPageId,
  ...trailingBreadcrumbs: PageBreadcrumb[]
): PageBreadcrumb[] {
  return buildWorkspacePageBreadcrumbs(
    "ceph-admin",
    CEPH_ADMIN_PAGE_CONTRACTS[pageId],
    ...trailingBreadcrumbs,
  );
}

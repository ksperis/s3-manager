/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";
import {
  MANAGER_PAGE_CONTRACTS,
  buildWorkspacePageBreadcrumbs,
} from "../../navigation/workspacePages";

export type ManagerPageId = keyof typeof MANAGER_PAGE_CONTRACTS;

export function managerPageBreadcrumbs(
  pageId: ManagerPageId,
  ...trailingBreadcrumbs: PageBreadcrumb[]
): PageBreadcrumb[] {
  return buildWorkspacePageBreadcrumbs(
    "manager",
    MANAGER_PAGE_CONTRACTS[pageId],
    ...trailingBreadcrumbs,
  );
}

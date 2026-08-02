/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";
import {
  STORAGE_OPS_PAGE_CONTRACTS,
  buildWorkspacePageBreadcrumbs,
} from "../../navigation/workspacePages";

type StorageOpsPageId = keyof typeof STORAGE_OPS_PAGE_CONTRACTS;

export function storageOpsPageBreadcrumbs(
  pageId: StorageOpsPageId,
  ...trailingBreadcrumbs: PageBreadcrumb[]
): PageBreadcrumb[] {
  return buildWorkspacePageBreadcrumbs(
    "storage-ops",
    STORAGE_OPS_PAGE_CONTRACTS[pageId],
    ...trailingBreadcrumbs,
  );
}
